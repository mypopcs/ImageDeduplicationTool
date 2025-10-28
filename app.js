$(document).ready(function () {
  const API_URL = "http://127.0.0.1:5000"; // Python 后端地址
  let currentRowData = []; // 存储所有行的数据

  // 1. 点击计算后开始处理
  $("#scan-btn").on("click", function () {
    const path = $("#dir-path").val();
    const hashType = $("input[name='hash-type']:checked").val();
    const threshold = $("#threshold").val();

    $("#loading").show();
    $("#pairs-table tbody").empty(); // 清空旧列表
    currentRowData = [];

    $.ajax({
      url: `${API_URL}/scan`,
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({
        path: path,
        hash_type: hashType,
        threshold: threshold,
      }),
      success: function (data) {
        $("#loading").hide();
        currentRowData = data.pairs;
        populateTable(data.pairs);
      },
      error: function (err) {
        $("#loading").hide();
        alert("扫描失败: " + err.responseJSON?.error);
      },
    });
  });

  function populateTable(pairs) {
    const $tbody = $("#pairs-table tbody");
    pairs.forEach((pair, index) => {
      const row = `
                <tr data-index="${index}">
                    <td>
                        <label><input type="radio" name="del-${index}" class="del-check" value="a">A</label>
                        <label><input type="radio" name="del-${index}" class="del-check" value="b">B</label>
                    </td>
                    <td class="path-a">${pair.file1.path}</td>
                    <td class="path-b">${pair.file2.path}</td>
                    <td>${pair.similarity}%</td>
                    <td>
                        <button class="btn-ignore">忽略</button>
                        <button class="btn-delete-both">均删</button>
                    </td>
                </tr>
            `;
      $tbody.append(row);
    });

    // 绑定行点击事件
    $tbody.find("tr").on("click", function (e) {
      // 防止点击按钮时也触发
      if ($(e.target).is("button") || $(e.target).is("input")) {
        return;
      }
      selectRow($(this));
    });
  }

  // 选中并预览行
  function selectRow($row) {
    if ($row.hasClass("ignored")) return; // 忽略的行不给选中

    const index = $row.data("index");
    const pair = currentRowData[index];

    $("#pairs-table tbody tr").removeClass("active");
    $row.addClass("active");

    // 路径 A 和 B
    const pathA = pair.file1.path;
    const pathB = pair.file2.path;

    // 更新预览图 (通过后端/image接口)
    $("#image-a").attr(
      "src",
      `${API_URL}/image?path=${encodeURIComponent(pathA)}`
    );
    $("#image-b").attr(
      "src",
      `${API_URL}/image?path=${encodeURIComponent(pathB)}`
    );

    // 更新图片信息
    $("#info-a").text(
      `路径: ${pathA} | ${pair.file1.resolution[0]}x${
        pair.file1.resolution[1]
      } | ${(pair.file1.file_size / 1024).toFixed(2)} KB`
    );
    $("#info-b").text(
      `路径: ${pathB} | ${pair.file2.resolution[0]}x${
        pair.file2.resolution[1]
      } | ${(pair.file2.file_size / 1024).toFixed(2)} KB`
    );

    // 更新悬浮删除按钮的数据
    $("#wrapper-a .delete-hover-btn").data("path", pathA);
    $("#wrapper-b .delete-hover-btn").data("path", pathB);
  }

  // ----------------------------------------------------------------------
  // 【新增函数】切换行的忽略状态 (包含样式和控件状态更新)
  // ----------------------------------------------------------------------
  function toggleIgnore($row, isIgnoring) {
    const $radios = $row.find(".del-check");
    const $ignoreBtn = $row.find(".btn-ignore");
    const $pathCells = $row.find(".path-a, .path-b");

    if (isIgnoring) {
      // 激活忽略状态
      $row.addClass("ignored").removeClass("active");
      $ignoreBtn.text("取消忽略"); // 1. 按钮文本改为取消忽略
      $radios.prop("disabled", true); // 3. radio buttons 禁用
      $radios.prop("checked", false); // 移除选择

      // 2. 文件名不需要加删除线：我们直接移除删除线的样式
      $pathCells.css("text-decoration", "none");

      // 清理预览区
      $("#image-a, #image-b").attr("src", "");
      $("#info-a, #info-b").text("");

      // 自动选中下一行 (如果有)
      let $nextRow = $row.nextAll(":not(.ignored)").first();
      if ($nextRow.length) selectRow($nextRow);
      else selectRow($("#pairs-table tbody tr:not(.ignored)").first());
    } else {
      // 取消忽略状态
      $row.removeClass("ignored");
      $ignoreBtn.text("忽略"); // 1. 按钮文本改回忽略
      $radios.prop("disabled", false); // 3. radio buttons 启用
    }
  }

  // -----------------------------------------------------------
  // Hash马赛克渲染函数 renderMosaic 已删除
  // -----------------------------------------------------------

  // 2. 支持键盘上下键切换
  $(document).on("keydown", function (e) {
    const $activeRow = $("#pairs-table tbody tr.active");
    if ($activeRow.length === 0) {
      // 如果没有选中的，默认选第一个
      let $first = $("#pairs-table tbody tr:not(.ignored)").first();
      if ($first.length) selectRow($first);
      return;
    }

    let $nextRow;
    if (e.which === 40) {
      // Down arrow
      $nextRow = $activeRow.nextAll(":not(.ignored)").first(); // 跳过已忽略的
    } else if (e.which === 38) {
      // Up arrow
      $nextRow = $activeRow.prevAll(":not(.ignored)").first(); // 跳过已忽略的
    }

    if ($nextRow && $nextRow.length > 0) {
      selectRow($nextRow);
      // 滚动到视图
      $nextRow[0].scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });

  // 1. 自动选择 (【修复版，包含调试输出】)
  $("#auto-select-btn").on("click", function () {
    if (currentRowData.length === 0) {
      alert("请先运行扫描。");
      return;
    }

    // 1. 获取所有自动选择的条件值
    const smallerRes = $("#select-smaller-res").is(":checked");
    const smallerSize = $("#select-smaller-size").is(":checked");
    const olderTime = $("#select-older-time").is(":checked");

    // 【相似度和文件名】
    const simThreshold = parseFloat($("#auto-sim-threshold").val());
    const requireSameFilename = $("#auto-filename-same").prop("checked");

    // 判断相似度是否被视为 AND 条件：只要用户输入了值 (且有效)，就视为激活。
    const useSimThreshold =
      !isNaN(simThreshold) && simThreshold >= 50 && simThreshold <= 100;

    // 2. 检查是否有任何条件被激活 (满足最少1个要求)
    const anyOrCriteriaActive = smallerRes || smallerSize || olderTime;
    const isAnyCriteriaActive =
      anyOrCriteriaActive || requireSameFilename || useSimThreshold;

    console.log("--- 自动选择开始 ---");
    console.log(
      `条件激活: ${isAnyCriteriaActive}, SimThreshold: ${simThreshold}, UseSim: ${useSimThreshold}, FnSame: ${requireSameFilename}, OrActive: ${anyOrCriteriaActive}`
    );

    if (!isAnyCriteriaActive) {
      alert(
        "请至少勾选一个选项，或在相似度输入框中填入一个有效值（例如 95）。"
      );
      return;
    }

    let autoSelectedCount = 0;

    $("#pairs-table tbody tr:not(.ignored)").each(function () {
      const $row = $(this);
      const index = $row.data("index");
      const pair = currentRowData[index];

      // -----------------------------------------------------------------
      // Phase 1: 检查所有激活的 AND 且条件
      // -----------------------------------------------------------------
      let allAndConditionsMet = true;

      // 【且运算 1】相似度检查
      if (useSimThreshold && pair.similarity < simThreshold) {
        allAndConditionsMet = false;
      }

      // 【且运算 2】文件名相同检查
      if (requireSameFilename) {
        const filenameA = pair.file1.path.split(/[\/\\]/).pop();
        const filenameB = pair.file2.path.split(/[\/\\]/).pop();
        if (filenameA !== filenameB) {
          allAndConditionsMet = false;
        }
      }

      console.log(
        `[Pair ${index}, Sim: ${pair.similarity}%] AND Met: ${allAndConditionsMet}`
      );

      // 如果 AND 且条件没有全部满足，则取消选中并跳过
      if (!allAndConditionsMet) {
        $row.find(".del-check").prop("checked", false);
        return;
      }

      // -----------------------------------------------------------------
      // Phase 2: 如果 AND 且条件全部满足，则应用 OR 逻辑选择删除对象
      // -----------------------------------------------------------------
      let choice = null; // 'a' or 'b'
      const infoA = pair.file1;
      const infoB = pair.file2;
      let resA = infoA.resolution[0] * infoA.resolution[1];
      let resB = infoB.resolution[0] * infoB.resolution[1];

      // 原始选择逻辑：小的删除 (OR 逻辑，按优先级顺序)
      if (smallerRes) {
        if (resA < resB) choice = "a";
        else if (resB < resA) choice = "b";
      }

      if (choice === null && smallerSize) {
        if (infoA.file_size < infoB.file_size) choice = "a";
        else if (infoB.file_size < infoA.file_size) choice = "b";
      }

      if (choice === null && olderTime) {
        if (infoA.mod_time < infoB.mod_time) choice = "a";
        else if (infoB.mod_time < infoA.mod_time) choice = "b";
      }

      // 【修正核心】默认选择逻辑 (当所有 OR 条件都没导致选择时，默认选 B)
      if (choice === null) {
        // 只要 AND 条件满足了，我们就必须选一个，默认选择 'b'
        choice = "b";
      }

      console.log(`[Pair ${index}] OR Choice: ${choice}`);

      // 3. 执行选中操作
      if (choice) {
        $row.find(`.del-check[value="${choice}"]`).prop("checked", true);
        // 确保另一个被取消选中
        const otherChoice = choice === "a" ? "b" : "a";
        $row.find(`.del-check[value="${otherChoice}"]`).prop("checked", false);
        autoSelectedCount++;
      } else {
        $row.find(".del-check").prop("checked", false);
      }
    });

    alert(`自动选择完成。共选中 ${autoSelectedCount} 对图片进行删除标记。`);
  });

  // 【新增】取消全部选择功能
  $("#unselect-all-btn").on("click", function () {
    console.log("--- 执行取消全部选择 ---");
    if (confirm("确认取消所有已选中的删除标记吗？")) {
      // 取消所有行中的 radio 选中状态
      $("#pairs-table tbody input.del-check").prop("checked", false);
      alert("已取消全部删除标记。");
    }
  });

  // 1. 批量删除
  $("#batch-delete-btn").on("click", async function () {
    if (!confirm("确认批量删除所有已选项吗？此操作不可恢复！")) {
      return;
    }
    // ... (批量删除代码省略，与您提供的代码逻辑一致)
    const filesToDelete = [];
    $("#pairs-table tbody tr:not(.ignored)").each(function () {
      const $row = $(this);
      const checkedVal = $row.find(".del-check:checked").val();
      if (checkedVal) {
        const index = $row.data("index");
        const pair = currentRowData[index];
        const path = checkedVal === "a" ? pair.file1.path : pair.file2.path;
        const existingFile = filesToDelete.find((f) => f.path === path);
        if (!existingFile) {
          filesToDelete.push({ path: path, pairIndex: index, key: checkedVal });
        }
      }
    });

    if (filesToDelete.length === 0) {
      alert("没有图片被选中删除。");
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const item of filesToDelete) {
      const result = await deleteFile(
        item.path,
        item.pairIndex,
        item.key,
        false
      );
      if (result) {
        successCount++;
      } else {
        failCount++;
      }
    }

    const totalPairs = currentRowData.length;
    const deletedFilesCount = filesToDelete.length;

    const logMessage = `
        批量删除结果 (${new Date().toLocaleTimeString()}):
        原始重复图片对数: ${totalPairs}
        计划删除文件数 (去重后): ${deletedFilesCount}
        删除成功数: ${successCount}
        删除失败数: ${failCount}
    `;
    console.log(logMessage);
    alert("批量删除完成！\n" + logMessage.trim());

    // 遍历所有行，将已删除文件的行移除 (软刷新)
    $("#pairs-table tbody tr:not(.ignored)").each(function () {
      const $row = $(this);
      const index = $row.data("index");
      const pair = currentRowData[index];

      // 如果 A 或 B 路径已经被标记为 "DELETED"，则移除该行
      if (pair.file1.path === "DELETED" && pair.file2.path === "DELETED") {
        $row.remove();
      }
    });

    // 重新选中第一行
    selectRow($("#pairs-table tbody tr:not(.ignored)").first());
  });

  // 3. 悬浮删除
  $(".delete-hover-btn").on("click", function () {
    const path = $(this).data("path");
    if (path && confirm(`确认删除 ${path} 吗？`)) {
      const $activeRow = $("#pairs-table tbody tr.active");
      const index = $activeRow.length ? $activeRow.data("index") : null;
      let key = null;
      if (index !== null) {
        const pair = currentRowData[index];
        if (pair.file1.path === path) key = "a";
        if (pair.file2.path === path) key = "b";
      }
      deleteFile(path, index, key);
    }
  });

  // 4. 忽略
  $("#pairs-table").on("click", ".btn-ignore", function () {
    const $row = $(this).closest("tr");

    // 检查当前是否为忽略状态
    const isIgnoring = $row.hasClass("ignored");

    // 调用新的切换函数
    toggleIgnore($row, !isIgnoring);
  });

  // 统一的删除函数 (返回 Promise 以支持 await)
  function deleteFile(path, pairIndex, key, showAlertOnError = true) {
    return new Promise((resolve) => {
      $.ajax({
        url: `${API_URL}/delete`,
        type: "POST",
        contentType: "application/json",
        data: JSON.stringify({ path: path }),
        success: function (data) {
          console.log("Deleted:", data.path);

          // 遍历所有数据，将路径匹配的文件标记为 "DELETED"
          currentRowData.forEach((pair, index) => {
            const isFile1 = pair.file1.path === data.path;
            const isFile2 = pair.file2.path === data.path;

            if (isFile1) {
              pair.file1.path = "DELETED";
              $(`#pairs-table tr[data-index="${index}"] .path-a`).text(
                "DELETED"
              );
            }
            if (isFile2) {
              pair.file2.path = "DELETED";
              $(`#pairs-table tr[data-index="${index}"] .path-b`).text(
                "DELETED"
              );
            }

            // 如果一行中的两张图都被删了，则直接移除该行
            if (
              pair.file1.path === "DELETED" &&
              pair.file2.path === "DELETED"
            ) {
              $(`#pairs-table tr[data-index="${index}"]`).remove();
            }
          });

          // 更新预览区状态
          if (
            $("#image-a").attr("src").includes(encodeURIComponent(data.path))
          ) {
            $("#image-a").attr("src", "");
            $("#info-a").text("已删除");
            $("#wrapper-a .delete-hover-btn").data("path", "");
          }
          if (
            $("#image-b").attr("src").includes(encodeURIComponent(data.path))
          ) {
            $("#image-b").attr("src", "");
            $("#info-b").text("已删除");
            $("#wrapper-b .delete-hover-btn").data("path", "");
          }

          resolve(true);
        },
        error: function (xhr, status, error) {
          const errMsg = xhr.responseJSON?.error || "未知错误";
          console.error(`删除失败: ${path} - ${errMsg}`);

          if (showAlertOnError) {
            alert(`删除失败: ${path} - ${errMsg}`);
          }

          resolve(false);
        },
      });
    });
  }

  // 4. 均删
  $("#pairs-table").on("click", ".btn-delete-both", function () {
    const $row = $(this).closest("tr");
    const index = $row.data("index");
    const pair = currentRowData[index];

    if (confirm(`确认全部删除 ${pair.file1.path} 和 ${pair.file2.path} 吗？`)) {
      Promise.all([
        deleteFile(pair.file1.path, index, "a"),
        deleteFile(pair.file2.path, index, "b"),
      ]).then(() => {
        // 重新选中下一行
        selectRow($("#pairs-table tbody tr:not(.ignored)").first());
      });
    }
  });
});
