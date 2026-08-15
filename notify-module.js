/**
 * 物候 — 通知系统公共模块
 * 统一管理站内通知的创建、查询、已读、渲染
 */
(function (global) {
  'use strict';

  const NotifyModule = {};

  /** 确保通知数组存在 */
  function ensureNotifications(data) {
    if (!Array.isArray(data.notifications)) data.notifications = [];
    return data.notifications;
  }

  /** 添加通知 */
  NotifyModule.addNotification = function (data, recipientId, type, title, body, meta) {
    ensureNotifications(data);
    data.notifications.unshift({
      id: (window.Utils && Utils.generateId) ? Utils.generateId('notif') : 'notif-' + Date.now().toString(36),
      userId: recipientId,
      type: type || 'info',
      title: title || '',
      body: body || '',
      read: false,
      createdAt: new Date().toISOString(),
      meta: meta || {}
    });
    if (data.notifications.length > 80) {
      data.notifications = data.notifications.slice(0, 80);
    }
  };

  /** 获取当前用户通知 */
  NotifyModule.getMyNotifications = function (data) {
    ensureNotifications(data);
    var user = (window.Auth && Auth.getUser) ? Auth.getUser() : (window.__currentUser || null);
    if (!user) return [];
    return data.notifications.filter(function (msg) {
      return msg.userId === user.studentId;
    });
  };

  /** 未读消息数 */
  NotifyModule.unreadCount = function (data) {
    return NotifyModule.getMyNotifications(data).filter(function (msg) { return !msg.read; }).length;
  };

  /** 全部标记已读 */
  NotifyModule.markAllRead = function (data) {
    ensureNotifications(data);
    var user = (window.Auth && Auth.getUser) ? Auth.getUser() : (window.__currentUser || null);
    if (!user) return;
    data.notifications.forEach(function (msg) {
      if (msg.userId === user.studentId) msg.read = true;
    });
  };

  /** 渲染消息列表 HTML */
  NotifyModule.renderMessageList = function (data) {
    var list = NotifyModule.getMyNotifications(data).slice(0, 20);
    var escape = (window.Utils && Utils.escapeHTML) || function (v) { return String(v ?? ''); };
    return list.map(function (msg) {
      return '<div class="message-item">' +
        '<div class="message-title">' + escape(msg.title) + '</div>' +
        '<div class="message-body">' + escape(msg.body) + '</div>' +
        '<div class="message-time">' + escape(msg.createdAt || '') + '</div>' +
        '</div>';
    }).join('');
  };

  /** 初始化消息中心 UI（绑定事件） */
  NotifyModule.initMessageCenter = function (data, options) {
    options = options || {};
    var msgBtn = document.getElementById('messageBtn');
    var msgPanel = document.getElementById('messagePanel');
    var msgList = document.getElementById('messageList');
    var msgBadge = document.getElementById('messageBadge');
    var msgMarkRead = document.getElementById('msgMarkAllRead');

    if (!msgBtn || !msgPanel || !msgList) return;

    function updateUI() {
      var unread = NotifyModule.unreadCount(data);
      if (msgBadge) {
        msgBadge.textContent = unread;
        msgBadge.style.display = unread > 0 ? 'inline-flex' : 'none';
      }
      msgList.innerHTML = NotifyModule.renderMessageList(data) || '<div style="text-align:center;color:var(--muted);padding:20px;">暂无消息</div>';
    }

    msgBtn.onclick = function (e) {
      e.stopPropagation();
      msgPanel.style.display = msgPanel.style.display === 'block' ? 'none' : 'block';
      updateUI();
    };

    document.addEventListener('click', function () {
      msgPanel.style.display = 'none';
    });

    msgPanel.onclick = function (e) { e.stopPropagation(); };

    if (msgMarkRead) {
      msgMarkRead.onclick = function () {
        NotifyModule.markAllRead(data);
        if (options.onSave) options.onSave();
        updateUI();
      };
    }

    if (options.onUpdate) options.onUpdate(updateUI);
    return { updateUI: updateUI };
  };

  global.NotifyModule = NotifyModule;
})(window);