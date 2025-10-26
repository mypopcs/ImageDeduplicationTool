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

    // 4. 更新马赛克预览
    renderMosaic("#hash-mosaic-a", pair.file1.hash_matrix);
    renderMosaic("#hash-mosaic-b", pair.file2.hash_matrix);

    // 更新悬浮删除按钮的数据
    $("#wrapper-a .delete-hover-btn").data("path", pathA);
    $("#wrapper-b .delete-hover-btn").data("path", pathB);
  }

  // 4. 渲染马赛克
  function renderMosaic(selector, matrix) {
    const $mosaic = $(selector);
    $mosaic.empty();
    if (!matrix) return;
    matrix.forEach((cell_val) => {
      $mosaic.append(`<div class="cell-${cell_val}"></div>`);
    });
  }

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

  // 1. 自动选择
  $("#auto-select-btn").on("click", function () {
    const smallerRes = $("#select-smaller-res").is(":checked");
    const smallerSize = $("#select-smaller-size").is(":checked");
    const olderTime = $("#select-older-time").is(":checked");

    $("#pairs-table tbody tr:not(.ignored)").each(function () {
      const $row = $(this);
      const index = $row.data("index");
      const pair = currentRowData[index];
      const infoA = pair.file1;
      const infoB = pair.file2;

      let resA = infoA.resolution[0] * infoA.resolution[1];
      let resB = infoB.resolution[0] * infoB.resolution[1];

      let choice = null; // 'a' or 'b'

      if (smallerRes) {
        if (resA < resB) choice = "a";
        if (resB < resA) choice = "b";
      }

      if (choice === null && smallerSize) {
        if (infoA.file_size < infoB.file_size) choice = "a";
        if (infoB.file_size < infoA.file_size) choice = "b";
      }

      if (choice === null && olderTime) {
        if (infoA.mod_time < infoB.mod_time) choice = "a";
        if (infoB.mod_time < infoA.mod_time) choice = "b";
      }

      // 如果标准都一样，默认选一个（或不选）
      if (choice === null && (smallerRes || smallerSize || olderTime)) {
        choice = "a"; // 举例：默认选A
      }

      if (choice) {
        $row.find(`.del-check[value="${choice}"]`).prop("checked", true);
      }
    });
  });

  // 1. 批量删除
  $("#batch-delete-btn").on("click", async function () {
    if (!confirm("确认批量删除所有已选项吗？此操作不可恢复！")) {
      return;
    }

    const filesToDelete = [];
    const $rows = [];

    // 收集所有待删除的文件和它们对应的DOM行
    $("#pairs-table tbody tr:not(.ignored)").each(function () {
      const $row = $(this);
      const checkedVal = $row.find(".del-check:checked").val(); // 'a' or 'b'
      if (checkedVal) {
        const index = $row.data("index");
        const pair = currentRowData[index];
        const path = checkedVal === "a" ? pair.file1.path : pair.file2.path;

        // 使用一个Set来去重路径，防止同一张图片因为出现在多对中而被多次添加到 filesToDelete
        const existingFile = filesToDelete.find((f) => f.path === path);
        if (!existingFile) {
          filesToDelete.push({ path: path, pairIndex: index, key: checkedVal });
        }
        $rows.push($row);
      }
    });

    if (filesToDelete.length === 0) {
      alert("没有图片被选中删除。");
      return;
    }

    let successCount = 0;
    let failCount = 0;

    // 遍历 filesToDelete，逐个执行删除
    for (const item of filesToDelete) {
      // 使用 await 保证顺序删除，避免同时操作同一行数据
      const result = await deleteFile(
        item.path,
        item.pairIndex,
        item.key,
        false
      ); // 不在 deleteFile 中弹窗

      if (result) {
        successCount++;
      } else {
        failCount++;
      }
    }

    // 【修正 3】日志记录
    const totalPairs = currentRowData.length;
    const deletedFilesCount = filesToDelete.length;

    const logMessage = `
        批量删除结果 (${new Date().toLocaleTimeString()}):
        原始重复图片对数: ${totalPairs}
        计划删除文件数 (去重后): ${deletedFilesCount}
        删除成功数: ${successCount}
        删除失败数: ${failCount}
        
        失败文件：(请查看控制台)
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
      deleteFile(path, $activeRow);
    }
  });

  // 4. 忽略
  $("#pairs-table").on("click", ".btn-ignore", function () {
    $(this).closest("tr").addClass("ignored").removeClass("active");
    // 清理预览
    $("#image-a, #image-b").attr("src", "");
    $("#info-a, #info-b").text("");
    $("#hash-mosaic-a, #hash-mosaic-b").empty();
  });

  // 4. 均删
  $("#pairs-table").on("click", ".btn-delete-both", function () {
    const $row = $(this).closest("tr");
    const index = $row.data("index");
    const pair = currentRowData[index];
    if (confirm(`确认全部删除 ${pair.file1.path} 和 ${pair.file2.path} 吗？`)) {
      // 两个都删
      deleteFile(pair.file1.path, null); // 不传row
      deleteFile(pair.file2.path, $row); // 第二个删完后再移除行
    }
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

          // 【修正 4】从 currentRowData 中移除被删除的文件信息
          // 遍历所有数据，将路径匹配的文件标记为 "DELETED"
          currentRowData.forEach((pair, index) => {
            const isFile1 = pair.file1.path === data.path;
            const isFile2 = pair.file2.path === data.path;

            if (isFile1) {
              // 将文件路径改为特殊标记
              pair.file1.path = "DELETED";
              // 同时清除路径信息, 避免后续误操作
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

          // 【修正 4】更新预览区状态 (如果删除的是当前预览的图)
          if (
            $("#image-a").attr("src").includes(encodeURIComponent(data.path))
          ) {
            $("#image-a").attr("src", "");
            $("#info-a").text("已删除");
            $("#wrapper-a .delete-hover-btn").data("path", ""); // 清空悬浮删除按钮数据
          }
          if (
            $("#image-b").attr("src").includes(encodeURIComponent(data.path))
          ) {
            $("#image-b").attr("src", "");
            $("#info-b").text("已删除");
            $("#wrapper-b .delete-hover-btn").data("path", "");
          }

          resolve(true); // 删除成功
        },
        error: function (xhr, status, error) {
          const errMsg = xhr.responseJSON?.error || "未知错误";
          console.error(`删除失败: ${path} - ${errMsg}`);

          // 【修正 2】如果批量删除，不弹窗，只打印日志
          if (showAlertOnError) {
            alert(`删除失败: ${path} - ${errMsg}`);
          }

          resolve(false); // 删除失败
        },
      });
    });
  }
  // 4. 均删 (更新为使用新的 deleteFile 函数)
  $("#pairs-table").on("click", ".btn-delete-both", function () {
    const $row = $(this).closest("tr");
    const index = $row.data("index");
    const pair = currentRowData[index];

    if (confirm(`确认全部删除 ${pair.file1.path} 和 ${pair.file2.path} 吗？`)) {
      // 使用 Promise.all 等待两个删除都完成
      Promise.all([
        deleteFile(pair.file1.path, index, "a"),
        deleteFile(pair.file2.path, index, "b"),
      ]).then(() => {
        // 两个文件都删除成功后，deleteFile 内部会处理行移除
      });
    }
  });
});
