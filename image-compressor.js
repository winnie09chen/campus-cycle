/**
 * 物候 — 图片压缩与上传优化模块
 * 支持 Canvas 压缩、缩略图生成、上传进度显示、分块上传
 */
(function (global) {
  'use strict';

  var ImageCompressor = {};

  /** 默认压缩配置 */
  var DEFAULT_OPTIONS = {
    maxWidth: 800,
    maxHeight: 800,
    quality: 0.7,
    format: 'image/jpeg',
    maxFileSize: 5 * 1024 * 1024 // 5MB
  };

  /**
   * 获取图片尺寸
   */
  ImageCompressor.getImageDimensions = function (file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          resolve({ width: img.naturalWidth, height: img.naturalHeight });
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  /**
   * 压缩图片（Canvas 方案）
   * @param {File|Blob} file - 图片文件
   * @param {Object} options - 压缩选项
   * @param {Function} onProgress - 进度回调 (0-100)
   * @returns {Promise<{dataUrl: string, blob: Blob, width: number, height: number, originalSize: number, compressedSize: number}>}
   */
  ImageCompressor.compress = function (file, options, onProgress) {
    options = Object.assign({}, DEFAULT_OPTIONS, options || {});
    var startTime = Date.now();

    if (onProgress) onProgress(10);

    // 校验文件类型
    if (file.size > options.maxFileSize) {
      return Promise.reject(new Error('图片文件过大，最大支持 ' + (options.maxFileSize / 1024 / 1024) + 'MB'));
    }

    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) {
        if (onProgress) onProgress(30);
        var img = new Image();
        img.onload = function () {
          if (onProgress) onProgress(50);

          var canvas = document.createElement('canvas');
          var ctx = canvas.getContext('2d');

          // 计算缩放尺寸
          var width = img.naturalWidth;
          var height = img.naturalHeight;

          if (width > options.maxWidth || height > options.maxHeight) {
            var ratio = Math.min(options.maxWidth / width, options.maxHeight / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }

          canvas.width = width;
          canvas.height = height;

          // 绘制缩放后的图片
          ctx.drawImage(img, 0, 0, width, height);

          if (onProgress) onProgress(70);

          // 输出为 dataURL
          var dataUrl = canvas.toDataURL(options.format, options.quality);

          if (onProgress) onProgress(85);

          // 同时转为 Blob
          var byteString = atob(dataUrl.split(',')[1]);
          var mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0];
          var ab = new ArrayBuffer(byteString.length);
          var ia = new Uint8Array(ab);
          for (var i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
          }
          var blob = new Blob([ab], { type: mimeString });

          if (onProgress) onProgress(100);

          resolve({
            dataUrl: dataUrl,
            blob: blob,
            width: width,
            height: height,
            originalSize: file.size,
            compressedSize: blob.size,
            compressionRatio: file.size > 0 ? Math.round((1 - blob.size / file.size) * 100) : 0,
            elapsed: Date.now() - startTime
          });
        };
        img.onerror = function () {
          reject(new Error('图片加载失败，请检查文件格式'));
        };
        img.src = e.target.result;
      };
      reader.onerror = function () {
        reject(new Error('文件读取失败'));
      };
      reader.readAsDataURL(file);
    });
  };

  /**
   * 生成缩略图
   */
  ImageCompressor.createThumbnail = function (file, maxSize) {
    maxSize = maxSize || 200;
    return ImageCompressor.compress(file, {
      maxWidth: maxSize,
      maxHeight: maxSize,
      quality: 0.6,
      format: 'image/jpeg'
    });
  };

  /**
   * 分块上传（模拟，Netlify 环境下使用单次 POST）
   * 返回进度更新函数
   */
  ImageCompressor.uploadWithProgress = function (dataUrl, uploadFn, onProgress) {
    return new Promise(function (resolve, reject) {
      if (onProgress) onProgress(0);
      // 模拟分块进度
      var steps = 4;
      var current = 0;
      var timer = setInterval(function () {
        current++;
        if (onProgress) onProgress(Math.min(90, Math.round((current / steps) * 100)));
      }, 100);

      uploadFn(dataUrl)
        .then(function (result) {
          clearInterval(timer);
          if (onProgress) onProgress(100);
          resolve(result);
        })
        .catch(function (err) {
          clearInterval(timer);
          reject(err);
        });
    });
  };

  /**
   * 将 DataURL 转为 File 对象
   */
  ImageCompressor.dataUrlToFile = function (dataUrl, fileName) {
    var arr = dataUrl.split(',');
    var mime = arr[0].match(/:(.*?);/)[1];
    var bstr = atob(arr[1]);
    var n = bstr.length;
    var u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], fileName || 'image.jpg', { type: mime });
  };

  /**
   * 验证图片文件格式
   */
  ImageCompressor.validateImage = function (file) {
    var allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      return { valid: false, error: '不支持的图片格式，请上传 JPEG、PNG、WebP、BMP 或 GIF 格式' };
    }
    if (file.size > DEFAULT_OPTIONS.maxFileSize) {
      return { valid: false, error: '图片文件过大，最大支持 5MB' };
    }
    return { valid: true };
  };

  /** 创建上传进度 UI 元素 */
  ImageCompressor.createProgressUI = function () {
    var container = document.createElement('div');
    container.className = 'upload-progress';
    container.style.cssText = 'display:none;margin-top:12px;';
    container.innerHTML = [
      '<div class="progress-bar-bg" style="background:#e6e8ec;border-radius:6px;height:8px;overflow:hidden;">',
      '<div class="progress-bar-fill" style="background:var(--red);height:100%;width:0%;transition:width .3s ease;border-radius:6px;"></div>',
      '</div>',
      '<div class="progress-text" style="font-size:12px;color:var(--muted);margin-top:4px;text-align:center;">准备上传...</div>'
    ].join('');
    return container;
  };

  /** 更新进度 UI */
  ImageCompressor.updateProgressUI = function (container, percent, text) {
    if (!container) return;
    container.style.display = 'block';
    var fill = container.querySelector('.progress-bar-fill');
    var label = container.querySelector('.progress-text');
    if (fill) fill.style.width = percent + '%';
    if (label) label.textContent = text || ('上传中 ' + percent + '%');
  };

  /** 隐藏进度 UI */
  ImageCompressor.hideProgressUI = function (container) {
    if (!container) return;
    setTimeout(function () {
      container.style.display = 'none';
    }, 1500);
  };

  global.ImageCompressor = ImageCompressor;
})(window);