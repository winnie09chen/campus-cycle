// ===== 鉴权前端模块（与 netlify/functions/auth.mjs 对接） =====
// 职责：登录/注册/会话存取/角色门禁。会话存 localStorage，token 由后端签发。
// 各页面在初始化时调用 AuthModule.restore() 恢复会话，再用 requireRole 守门。
(function (global) {
  "use strict";

  const CFG = (global.AppConfig && global.AppConfig.auth) || {};
  const API_URL = CFG.apiEndpoint || "/.netlify/functions/auth";
  const SESSION_KEY = (global.AppConfig && global.AppConfig.storageKeys && global.AppConfig.storageKeys.session) || "campus_cycle_session_v1";
  const ROLES = (global.AppConfig && global.AppConfig.roles) || { student: "student", reviewer: "reviewer" };
  const LOGIN_PAGE = (global.AppConfig && global.AppConfig.auth && global.AppConfig.auth.loginPage) || "login.html";

  // ---------- 会话存取 ----------
  function getSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY)) || null;
    } catch (e) {
      return null;
    }
  }
  function setSession(session) {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  }
  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }
  function getToken() {
    const s = getSession();
    return (s && s.token) || null;
  }
  function isLoggedIn() {
    return !!getToken();
  }
  function getCurrentUser() {
    const s = getSession();
    if (!s) return null;
    return {
      studentId: s.studentId,
      nickname: s.nickname,
      avatar: s.avatar,
      role: s.role,
      status: s.status,
      email: s.email
    };
  }
  function isVerified() {
    const s = getSession();
    return !!s && s.status === "verified";
  }

  // ---------- 后端调用 ----------
  async function call(action, data) {
    const token = getToken();
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...(data || {}), token })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ("请求失败 (" + res.status + ")"));
    return body;
  }

  async function sendCode(email) {
    return call("sendCode", { email });
  }

  async function register(email, studentId, code) {
    return call("register", { email, studentId, code });
  }

  async function login(studentId, password) {
    const body = await call("login", { studentId, password });
    const u = body.user;
    setSession({
      token: body.token,
      studentId: u.studentId,
      email: u.email,
      nickname: u.nickname,
      avatar: u.avatar,
      role: u.role,
      status: u.status
    });
    return body;
  }

  // ---------- 审核员专用 ----------
  async function listUsers(status) {
    return call("listUsers", status ? { status } : {});
  }
  async function verifyUser(studentId, decision) {
    return call("verifyUser", { studentId, decision });
  }
  async function addReviewer(studentId, email, nickname) {
    return call("addReviewer", { studentId, email, nickname });
  }

  // 刷新页面时用 token 恢复最新用户信息，顺带校验会话有效性
  async function restore() {
    const token = getToken();
    if (!token) return null;
    try {
      const body = await call("me", {});
      const u = body.user;
      setSession({
        token,
        studentId: u.studentId,
        email: u.email,
        nickname: u.nickname,
        avatar: u.avatar,
        role: u.role,
        status: u.status
      });
      return u;
    } catch (e) {
      clearSession();
      return null;
    }
  }

  function logout() {
    clearSession();
  }

  // ---------- 跳转 ----------
  function gotoLogin() {
    const back = encodeURIComponent(location.pathname.split("/").pop() || "index.html");
    location.href = LOGIN_PAGE + "?redirect=" + back;
  }

  function redirectByRole(role) {
    location.href = role === ROLES.reviewer ? "reviewer.html" : "index.html";
  }

  // ---------- 门禁守卫（页面初始化时调用） ----------
  // requireRole("student"/"reviewer")：未登录或角色不符 → 跳登录页，返回 false
  async function requireRole(expectedRole) {
    const user = await restore();
    if (!user || user.role !== expectedRole) {
      gotoLogin();
      return false;
    }
    return true;
  }

  // ---------- UI 辅助 ----------
  function avatarHtml(user, size) {
    const s = size || 32;
    const av = (user && user.avatar) || { letter: "?", color: "#c8192e" };
    const style =
      "width:" + s + "px;height:" + s + "px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;" +
      "color:#fff;font-weight:700;font-size:" + Math.round(s * 0.5) + "px;background:" + av.color + ";flex:0 0 auto;";
    return '<span style="' + style + '">' + (av.letter || "?") + "</span>";
  }

  global.AuthModule = {
    ROLES,
    SESSION_KEY,
    getSession,
    setSession,
    clearSession,
    getToken,
    isLoggedIn,
    getCurrentUser,
    isVerified,
    sendCode,
    register,
    login,
    logout,
    restore,
    requireRole,
    redirectByRole,
    gotoLogin,
    avatarHtml,
    listUsers,
    verifyUser,
    addReviewer
  };
})(window);
