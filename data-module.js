/**
 * 物候 — 数据管理公共模块
 * 统一管理数据加载、存储、远程同步、类别映射
 * 替代 index.html 和 reviewer.html 中的重复代码
 * （集成版：data/ai/image 后端需登录会话，所有远程请求带 Authorization 头）
 */
(function (global) {
  'use strict';

  const DataModule = {};

  const STORAGE_KEY = (window.AppConfig && window.AppConfig.storageKeys && window.AppConfig.storageKeys.data) || 'campus_cycle_demo_v1';

  const REMOTE_DATA_URL = '/.netlify/functions/data';
  const REMOTE_IMAGE_URL = '/.netlify/functions/image';
  const REMOTE_SYNC_MS = 3000;

  let remoteSyncReady = false;
  let remoteSnapshot = '';
  let remoteSaving = false;

  /** 带登录会话的请求头（后端 data/ai/image 均需鉴权） */
  function authHeaders(extra) {
    const token = global.AuthModule && global.AuthModule.getToken();
    const headers = Object.assign({}, extra);
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
  }
  DataModule.authHeaders = authHeaders;

  /** 种子数据 */
  const seedData = {
    items: [
      {
        id: 'item-1', ownerId: 'student', ownerName: '演示学生',
        title: '高等数学上册', category: 'book', subject: '高等数学', major: '通识',
        price: 16, conditionScore: 88, confidence: 0.93, status: 'approved', reports: 0,
        tags: ['有笔记', '封面轻微折角', '适合大一'],
        description: '高等数学上册，内页完整，前几章有铅笔笔记，适合想提前预习或复习的同学。'
      },
      {
        id: 'item-2', ownerId: 'student', ownerName: '演示学生',
        title: '夏季校服套装', category: 'uniform', subject: '校服', major: '不限',
        price: 45, conditionScore: 91, confidence: 0.86, status: 'approved', reports: 0,
        tags: ['尺码L', '已清洗', '无明显污渍'],
        description: '夏季校服套装，整体干净，适合临时补备用校服或活动穿着。'
      },
      {
        id: 'item-3', ownerId: 'student', ownerName: '演示学生',
        title: '宿舍护眼台灯', category: 'lamp', subject: '台灯', major: '不限',
        price: 28, conditionScore: 83, confidence: 0.78, status: 'approved', reports: 1,
        tags: ['亮度可调', '底座有划痕'],
        description: '宿舍学习台灯，亮度可调，底座有少量使用痕迹，功能正常。'
      },
      {
        id: 'item-4', ownerId: 'student', ownerName: '演示学生',
        title: '线性代数教材', category: 'book', subject: '线性代数', major: '计算机',
        price: 12, conditionScore: 76, confidence: 0.9, status: 'pending', reports: 0,
        tags: ['有划线', '待审核'],
        description: '线性代数教材，适合计算机和工科同学，部分章节有划线。'
      }
    ],
    demands: [{
      id: 'demand-1', text: '求一本大一下高等数学，最好有笔记，20元以内',
      category: 'book', subject: '高等数学', major: '计算机', priceMax: 20, wantsNotes: true
    }],
    aidNeeds: [],
    orders: [],
    balances: {},
    notifications: [],
    currentDraft: null,
    reviews: [],
    auditLogs: [],
    wishlist: []
  };

  /** 类别映射 */
  const categoryMap = (window.AppConfig && window.AppConfig.categories && window.AppConfig.categories.labels) || {
    book: '教材', uniform: '校服', lamp: '台灯', backpack: '书包',
    bottle: '水杯', clothing: '校服/正装', digital: '数码配件', custom: '其他'
  };

  /** 获取类别标签 */
  DataModule.getCategoryLabel = function (itemOrCategory) {
    if (typeof itemOrCategory === 'object' && itemOrCategory) {
      return itemOrCategory.customCategory || categoryMap[itemOrCategory.category] || itemOrCategory.category || '其他';
    }
    return categoryMap[itemOrCategory] || itemOrCategory || '其他';
  };

  DataModule.categoryMap = categoryMap;

  /** 加载本地数据 */
  DataModule.loadData = function () {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seedData));
      return structuredClone(seedData);
    }
    const parsed = JSON.parse(stored);
    return {
      ...parsed,
      items: Array.isArray(parsed.items) ? parsed.items : seedData.items,
      demands: Array.isArray(parsed.demands) ? parsed.demands : seedData.demands,
      aidNeeds: Array.isArray(parsed.aidNeeds) ? parsed.aidNeeds : seedData.aidNeeds,
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      balances: (parsed.balances && typeof parsed.balances === 'object') ? parsed.balances : {},
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
      currentDraft: parsed.currentDraft || null,
      reviews: Array.isArray(parsed.reviews) ? parsed.reviews : [],
      auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [],
      wishlist: Array.isArray(parsed.wishlist) ? parsed.wishlist : []
    };
  };

  /** 数据规范化 */
  DataModule.normalizeData = function (value) {
    return {
      ...value,
      items: Array.isArray(value.items) ? value.items : seedData.items,
      demands: Array.isArray(value.demands) ? value.demands : seedData.demands,
      aidNeeds: Array.isArray(value.aidNeeds) ? value.aidNeeds : seedData.aidNeeds,
      orders: Array.isArray(value.orders) ? value.orders : [],
      balances: (value.balances && typeof value.balances === 'object') ? value.balances : {},
      notifications: Array.isArray(value.notifications) ? value.notifications : [],
      currentDraft: value.currentDraft || null,
      reviews: Array.isArray(value.reviews) ? value.reviews : [],
      auditLogs: Array.isArray(value.auditLogs) ? value.auditLogs : [],
      wishlist: Array.isArray(value.wishlist) ? value.wishlist : []
    };
  };

  /** 剥离图片 base64 再存储 */
  DataModule.stripStoredImages = function (value) {
    return {
      ...value,
      items: (value.items || []).map(function (item) {
        return { ...item, image: item.image && !String(item.image).startsWith('data:') ? item.image : '' };
      }),
      currentDraft: value.currentDraft ? { ...value.currentDraft, image: '' } : null
    };
  };

  /** 远程拉取数据 */
  DataModule.fetchRemoteData = async function () {
    if (location.protocol === 'file:') return null;
    var response = await fetch(REMOTE_DATA_URL, { cache: 'no-store', headers: authHeaders() });
    if (!response.ok) throw new Error('远程数据读取失败：' + response.status);
    var payload = await response.json();
    return payload && payload.data ? DataModule.normalizeData(payload.data) : null;
  };

  /** 远程推送数据 */
  DataModule.pushRemoteData = async function (value) {
    if (location.protocol === 'file:') return;
    remoteSaving = true;
    try {
      var clean = DataModule.stripStoredImages(value);
      var body = JSON.stringify(clean);
      remoteSnapshot = body;
      var response = await fetch(REMOTE_DATA_URL, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: body
      });
      if (!response.ok) throw new Error('远程数据保存失败：' + response.status);
    } catch (error) {
      console.warn('远程同步失败，已保留本地数据：', error.message);
    } finally {
      remoteSaving = false;
    }
  };

  /** 上传图片到远程存储 */
  DataModule.uploadRemoteImage = async function (item) {
    if (!item || !item.image || !String(item.image).startsWith('data:') || location.protocol === 'file:') return item;
    try {
      var imageId = item.imageId || (item.id + '-image');
      var response = await fetch(REMOTE_IMAGE_URL, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id: imageId, image: item.image })
      });
      if (!response.ok) throw new Error('图片上传失败：' + response.status);
      var payload = await response.json();
      return { ...item, imageId: imageId, image: payload.url || (REMOTE_IMAGE_URL + '?id=' + encodeURIComponent(imageId)) };
    } catch (error) {
      console.warn('图片远程保存失败，发布数据会继续同步但跨设备可能看不到图：', error.message);
      return item;
    }
  };

  /** 保存数据到本地 + 触发远程同步 */
  DataModule.saveData = function (data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.warn('localStorage 写入失败，已移除图片后重试：', error.message);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DataModule.stripStoredImages(data)));
    }
    DataModule.pushRemoteData(data);
  };

  /** 远程同步状态 */
  DataModule.getRemoteState = function () {
    return { remoteSyncReady: remoteSyncReady, remoteSnapshot: remoteSnapshot, remoteSaving: remoteSaving };
  };
  DataModule.setRemoteSyncReady = function (v) { remoteSyncReady = v; };
  DataModule.setRemoteSnapshot = function (v) { remoteSnapshot = v; };
  DataModule.getRemoteSyncMs = function () { return REMOTE_SYNC_MS; };
  DataModule.getRemoteDataUrl = function () { return REMOTE_DATA_URL; };
  DataModule.getRemoteImageUrl = function () { return REMOTE_IMAGE_URL; };
  DataModule.getStorageKey = function () { return STORAGE_KEY; };
  DataModule.getSeedData = function () { return seedData; };

  /** 周期性远程同步（模块状态为唯一真相源，页面不再持有副本） */
  let syncTimer = null;
  DataModule.syncFromRemote = async function () {
    if (remoteSaving) return;
    try {
      const remoteData = await DataModule.fetchRemoteData();
      if (!remoteData) {
        if (!remoteSyncReady) await DataModule.pushRemoteData(DataModule.loadData());
        remoteSyncReady = true;
        return;
      }
      const nextSnapshot = JSON.stringify(DataModule.stripStoredImages(remoteData));
      if (nextSnapshot !== remoteSnapshot) {
        remoteSnapshot = nextSnapshot;
        localStorage.setItem(STORAGE_KEY, nextSnapshot);
        if (typeof DataModule.onRemoteChange === 'function') DataModule.onRemoteChange();
      }
      remoteSyncReady = true;
    } catch (error) {
      console.warn('远程数据读取失败，继续使用本地数据：', error.message);
    }
  };

  /** 启动远程同步；onChange 为远端变化时的回调（如 renderAll） */
  DataModule.initSync = function (onChange) {
    DataModule.onRemoteChange = onChange;
    DataModule.syncFromRemote();
    if (location.protocol !== 'file:' && !syncTimer) {
      syncTimer = setInterval(DataModule.syncFromRemote, REMOTE_SYNC_MS);
    }
  };

  global.DataModule = DataModule;
})(window);
