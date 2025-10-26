import os
import json
import sqlite3
import multiprocessing
import pybktree  # <-- 新导入
from functools import partial  # <-- 新导入
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from PIL import Image
import imagehash

# -----------------------------------------------------
# 解决 DecompressionBombWarning
Image.MAX_IMAGE_PIXELS = None
# -----------------------------------------------------

app = Flask(__name__)
CORS(app)

# --- 优化1: 持久化缓存数据库 ---
DB_PATH = 'image_cache.db'

def init_db():
    """初始化数据库, 创建缓存表"""
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute('''
        CREATE TABLE IF NOT EXISTS image_cache (
            filepath TEXT PRIMARY KEY,
            mod_time REAL,
            hash_type TEXT,
            hash TEXT,
            hash_matrix TEXT,
            resolution TEXT,
            file_size INTEGER
        )
        ''')
# 程序启动时立即初始化数据库
init_db()


# --- 优化3: BK-Tree 辅助函数 ---
def hamming_distance(h1, h2):
    """计算两个 imagehash 对象之间的汉明距离"""
    return h1 - h2


# --- 优化2: 并行计算的 "Worker" 函数 ---
# 它必须是顶级函数, 才能被 multiprocessing "pickle"
def get_image_info_worker(filepath, hash_type='phash'):
    """(Worker) 获取单个图片的信息, 专为并行计算设计"""
    try:
        with Image.open(filepath) as img:
            info = {
                "path": filepath,
                "resolution": img.size, # (width, height)
                "file_size": os.path.getsize(filepath),
                "mod_time": os.path.getmtime(filepath),
            }
            
            if hash_type == 'ahash':
                hash_obj = imagehash.average_hash(img)
            elif hash_type == 'dhash':
                hash_obj = imagehash.dhash(img)
            else: # 默认 phash
                hash_obj = imagehash.phash(img)
            
            info["hash"] = str(hash_obj)
            # json.dumps 用于存入 sqlite
            info["hash_matrix"] = json.dumps(hash_obj.hash.flatten().astype(int).tolist())
            info["resolution"] = json.dumps(info["resolution"]) # tuple 转 json
            
            return info
            
    except Exception as e:
        print(f"Error processing {filepath}: {e}")
        return None

# -----------------------------------------------------
# (旧的 get_image_info 和 image_data_cache 已被删除)
# -----------------------------------------------------


# 1. 载入图片目录就能开始识别 (重构后的函数)
@app.route('/scan', methods=['POST'])
def scan_directory():
    print("--- [进度] /scan POST 请求已收到。---")
    
    data = request.json
    scan_path = data.get('path')
    hash_type = data.get('hash_type', 'phash')
    threshold = int(data.get('threshold', 90))
    
    print(f"--- [进度] 开始扫描路径: {scan_path} (Hash: {hash_type}, 阈值: {threshold}%)")

    if not os.path.isdir(scan_path):
        return jsonify({"error": "路径无效"}), 400

    # === 第1阶段: 遍历文件 & 对比缓存 ===
    print(f"--- [进度] 正在遍历文件夹... ---")
    all_files_in_dir = []
    for root, _, files in os.walk(scan_path):
        for file in files:
            if file.lower().endswith(('.png', '.jpg', '.jpeg', '.bmp')):
                all_files_in_dir.append(os.path.join(root, file))
    
    total_files = len(all_files_in_dir)
    print(f"--- [进度] 遍历完成，共找到 {total_files} 张图片。---")
    print(f"--- [进度] 正在检查SQLite缓存... ---")

    files_to_process = [] # 需要计算Hash的
    all_image_infos = {}  # 存储所有(缓存+新)图片信息
    
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.cursor()
        for filepath in all_files_in_dir:
            try:
                current_mod_time = os.path.getmtime(filepath)
                cursor.execute(
                    "SELECT mod_time, hash, hash_matrix, resolution, file_size FROM image_cache WHERE filepath = ? AND hash_type = ?",
                    (filepath, hash_type)
                )
                row = cursor.fetchone()
                
                if row and row[0] == current_mod_time:
                    # 缓存有效
                    all_image_infos[filepath] = {
                        "path": filepath,
                        "mod_time": row[0],
                        "hash": row[1],
                        "hash_matrix": json.loads(row[2]), # 从json转回list
                        "resolution": json.loads(row[3]), # 从json转回list/tuple
                        "file_size": row[4]
                    }
                else:
                    # 缓存无效或不存在, 需要处理
                    files_to_process.append(filepath)
            except Exception as e:
                print(f"Skipping file {filepath}: {e}") # e.g. FileNotFoundError

    print(f"--- [进度] 缓存检查完毕。{len(all_image_infos)} 张来自缓存, {len(files_to_process)} 张需要计算。---")


    # === 第2阶段: 并行计算新Hash ===
    if files_to_process:
        print(f"--- [进度] 开始使用 {multiprocessing.cpu_count()} 核心并行计算 {len(files_to_process)} 个新Hash... ---")
        
        # 使用 functools.partial 传递固定的 hash_type 参数
        worker_with_hash_type = partial(get_image_info_worker, hash_type=hash_type)
        
        newly_processed_infos = []
        with multiprocessing.Pool() as pool:
            # imap_unordered 会在任务完成时立即返回结果, 方便展示进度
            for i, info in enumerate(pool.imap_unordered(worker_with_hash_type, files_to_process)):
                if info:
                    newly_processed_infos.append(info)
                    all_image_infos[info['path']] = info # 添加到总信息库
                
                if (i + 1) % 50 == 0 or (i + 1) == len(files_to_process):
                     print(f"    [Hash进度] 已计算 {i + 1} / {len(files_to_process)} 张新图片...")
        
        print(f"--- [进度] Hash 计算完毕。正在更新缓存数据库... ---")
        
        # 将新结果批量写入数据库
        with sqlite3.connect(DB_PATH) as conn:
            cursor = conn.cursor()
            for info in newly_processed_infos:
                cursor.execute(
                    "INSERT OR REPLACE INTO image_cache (filepath, mod_time, hash_type, hash, hash_matrix, resolution, file_size) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        info['path'], info['mod_time'], hash_type, info['hash'],
                        info['hash_matrix'], # 已经是json string
                        info['resolution'],  # 已经是json string
                        info['file_size']
                    )
                )
            conn.commit()
        print(f"--- [进度] 缓存更新完毕。---")

    # === 第3阶段: BK-Tree 优化对比 ===
    print(f"--- [进度] 开始使用 BK-Tree 进行相似度对比... ---")
    
    # 1. 构建 Hash -> [文件列表] 的映射
    hash_to_files = {}
    for info in all_image_infos.values():
        hash_obj = imagehash.hex_to_hash(info['hash'])
        if hash_obj not in hash_to_files:
            hash_to_files[hash_obj] = []
        hash_to_files[hash_obj].append(info)

    # 2. 用 *独特* 的hash构建BK-Tree
    tree = pybktree.BKTree(hamming_distance)
    unique_hashes = list(hash_to_files.keys())
    for h in unique_hashes:
        tree.add(h)
    
    print(f"--- [进度] BK-Tree 构建完毕 (共 {len(unique_hashes)} 个独特hash)。正在查找相似对... ---")
    
    similar_pairs = []
    checked_pairs = set() # 用于防止 (A,B) 和 (B,A) 重复
    
    # 3. 计算相似度阈值对应的 "距离"
    # 相似度95% -> 差异度 5%
    # 64 * 0.05 = 3.2。所以汉明距离 <= 3
    max_distance = int(64 * (1 - (threshold / 100)))
    print(f"--- [进度] 相似度 {threshold}% 对应最大汉明距离: {max_distance} ---")

    # 4. 遍历 *独特hash* 并查询tree
    for i, hash1 in enumerate(unique_hashes):
        if (i + 1) % 100 == 0:
            print(f"    [对比进度] 正在查询第 {i + 1} / {len(unique_hashes)} 个独特hash...")

        # results 包含 (distance, hash_obj)
        results = tree.find(hash1, max_distance)
        
        # 5. 处理查询结果
        files_with_hash1 = hash_to_files[hash1]
        
        for dist, hash2 in results:
            files_with_hash2 = hash_to_files[hash2]
            
            # 对 hash1 列表和 hash2 列表中的文件进行两两组合
            for info1 in files_with_hash1:
                for info2 in files_with_hash2:
                    # 避免自己和自己比
                    if info1['path'] == info2['path']:
                        continue
                    
                    # 避免 (A,B) 和 (B,A) 重复
                    pair_key = tuple(sorted((info1['path'], info2['path'])))
                    if pair_key in checked_pairs:
                        continue
                    
                    checked_pairs.add(pair_key)
                    
                    # 重新计算精确相似度, 因为 BK-Tree 仅用于快速筛选
                    h1_obj = imagehash.hex_to_hash(info1['hash'])
                    h2_obj = imagehash.hex_to_hash(info2['hash'])
                    hash_diff = h1_obj - h2_obj
                    similarity = (64 - hash_diff) / 64 * 100
                    
                    # 确保它真的符合阈值
                    if similarity >= threshold:
                        similar_pairs.append({
                            "file1": info1,
                            "file2": info2,
                            "similarity": round(similarity, 2)
                        })

    print(f"--- [进度] 对比完成！共找到 {len(similar_pairs)} 对相似图片。---")
    print(f"--- [进度] 正在向前端发送JSON数据... ---")

    return jsonify({"pairs": similar_pairs})


# 接口：用于前端 <img> 标签显示本地图片
@app.route('/image', methods=['GET'])
def get_image():
    image_path = request.args.get('path')
    if not image_path or ".." in image_path:
        return "Invalid path", 400
    
    if os.path.exists(image_path):
        return send_file(image_path)
    else:
        return "File not found", 404

# 接口：删除文件
# 1. 支持批量删除
@app.route('/delete', methods=['POST'])
def delete_file():
    data = request.json
    file_path = data.get('path')
    
    # 【优化】如果文件不存在，直接返回 404，而不是 500
    if not file_path or not os.path.exists(file_path):
        return jsonify({"error": "文件不存在或路径无效"}), 404
        
    try:
        os.remove(file_path)
        
        # 从缓存中也删除
        try:
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute("DELETE FROM image_cache WHERE filepath = ?", (file_path,))
                conn.commit()
        except Exception as db_e:
            # 记录缓存删除失败，但不影响主操作
            print(f"Error removing from cache: {db_e}")
            
        print(f"Deleted: {file_path}")
        return jsonify({"success": True, "path": file_path})
    except Exception as e:
        print(f"Error deleting {file_path}: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    # 必须在 __name__ == '__main__' 保护下启动 multiprocessing
    multiprocessing.freeze_support() # for Windows
    app.run(debug=True, port=5000)