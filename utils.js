/**
 * 物候 — 公共工具函数模块
 * 提供 escapeHTML、日期格式化、防抖、Toast 提示等通用能力
 */
(function (global) {
  'use strict';

  const Utils = {};

  /** HTML 转义，防止 XSS */
  Utils.escapeHTML = function (value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  /** 格式化日期为 YYYY-MM-DD HH:mm */
  Utils.formatDate = function (dateInput) {
    if (!dateInput) return '';
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  /** 格式化金额 */
  Utils.formatCurrency = function (value) {
    return '¥' + Number(value ?? 0).toFixed(2);
  };

  /** 防抖函数 */
  Utils.debounce = function (fn, delay) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  };

  /** 节流函数 */
  Utils.throttle = function (fn, delay) {
    let last = 0;
    return function (...args) {
      const now = Date.now();
      if (now - last >= delay) {
        last = now;
        fn.apply(this, args);
      }
    };
  };

  /** 生成唯一 ID */
  Utils.generateId = function (prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  };

  /** Toast 提示 */
  Utils.showToast = function (message, type) {
    type = type || 'info';
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    toast.style.cssText = [
      'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:10000;',
      'padding:12px 28px;border-radius:10px;font-size:15px;font-weight:600;',
      'box-shadow:0 8px 30px rgba(0,0,0,0.18);transition:opacity .35s ease;pointer-events:none;',
      type === 'success' ? 'background:#168a52;color:#fff;' :
      type === 'error' ? 'background:#b42318;color:#fff;' :
      type === 'warn' ? 'background:#b56a00;color:#fff;' :
      'background:#20242a;color:#fff;'
    ].join('');
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 400);
    }, 2500);
  };

  /** 确认对话框 */
  Utils.confirmDialog = function (message, title) {
    return new Promise(function (resolve) {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;';
      overlay.innerHTML = [
        '<div style="background:#fff;border-radius:14px;padding:28px 32px;max-width:380px;width:90%;box-shadow:0 20px 50px rgba(0,0,0,0.2);">',
        '<h3 style="margin:0 0 10px;font-size:17px;">' + Utils.escapeHTML(title || '确认操作') + '</h3>',
        '<p style="margin:0 0 22px;color:#68707d;font-size:14px;line-height:1.6;">' + Utils.escapeHTML(message) + '</p>',
        '<div style="display:flex;gap:10px;justify-content:flex-end;">',
        '<button class="confirm-cancel" style="border:1px solid #e6e8ec;background:#fff;color:#20242a;border-radius:8px;padding:9px 20px;font-weight:700;cursor:pointer;">取消</button>',
        '<button class="confirm-ok" style="background:#c8192e;color:#fff;border:0;border-radius:8px;padding:9px 20px;font-weight:700;cursor:pointer;">确认</button>',
        '</div></div>'
      ].join('');
      document.body.appendChild(overlay);
      overlay.querySelector('.confirm-cancel').onclick = function () { overlay.remove(); resolve(false); };
      overlay.querySelector('.confirm-ok').onclick = function () { overlay.remove(); resolve(true); };
      overlay.onclick = function (e) { if (e.target === overlay) { overlay.remove(); resolve(false); } };
    });
  };

  /** 获取 URL 查询参数 */
  Utils.getQueryParam = function (name) {
    const params = new URLSearchParams(location.search);
    return params.get(name);
  };

  global.Utils = Utils;
})(window);