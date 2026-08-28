'use strict';

/* ============================================================
 * store.js — 数据层
 * 职责：state 的默认值 / 加载 / 迁移 / 保存 / 通用工具函数
 * 依赖：无（最先加载）
 * 暴露：window.Store
 * ============================================================ */

const TASK_TYPES = {
  main: { label: '主线任务', icon: '⚔️', color: '#f5b301' },
  side: { label: '支线任务', icon: '✦',  color: '#38bdf8' },
};
const TASK_TYPE_KEYS = ['main', 'side'];

const STORAGE_KEY = 'questBoard.state.v1';
const CURRENT_VERSION = 1;

// localStorage 是否可用（隐私模式等场景会抛异常）
const storageAvailable = (() => {
  try {
    const k = '__questBoard_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch (e) {
    return false;
  }
})();

function defaultState() {
  return {
    version: CURRENT_VERSION,
    tasks: [],
    achievements: {},
    stats: { totalCompleted: 0, createdCount: 0 },
  };
}

// 迁移：MIGRATIONS[v] 表示「迁移到版本 v」，入参为 v-1 版本的状态
const MIGRATIONS = {
  1: (raw) => ({
    ...raw,
    version: 1,
    achievements: raw.achievements || {},
    stats: { totalCompleted: 0, createdCount: 0, ...(raw.stats || {}) },
  }),
};

// 数字兜底：null/undefined/空串视为无效，其余数字字符串也可转换
function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 单任务兜底清洗：补默认字段、清非法值
function normalizeTask(t) {
  if (!t || typeof t !== 'object') return null;
  const target = Math.max(1, Math.floor(toNum(t.target) ?? 1));
  const progress = Math.min(Math.max(0, Math.floor(toNum(t.progress) ?? 0)), target);
  // 只依据 status 判定完成：恢复后「进度满但未完成」是合法状态（如 8/8 恢复）
  const completed = t.status === 'completed';
  return {
    id: String(t.id || genId()),
    title: String(t.title || '').slice(0, 200),
    type: TASK_TYPE_KEYS.includes(t.type) ? t.type : 'main',
    destination: String(t.destination || '').slice(0, 60),
    progress,
    target,
    status: completed ? 'completed' : 'active',
    order: Math.floor(toNum(t.order) ?? 0),
    createdAt: toNum(t.createdAt) ?? Date.now(),
    updatedAt: toNum(t.updatedAt) ?? Date.now(),
    completedAt: completed ? (toNum(t.completedAt) ?? Date.now()) : null,
  };
}

// 整体兜底清洗
function normalize(state) {
  const s = defaultState();
  if (!state || typeof state !== 'object') return s;
  s.tasks = (Array.isArray(state.tasks) ? state.tasks : []).map(normalizeTask).filter(Boolean);
  s.achievements = (state.achievements && typeof state.achievements === 'object') ? state.achievements : {};
  s.stats = {
    totalCompleted: toNum(state.stats && state.stats.totalCompleted) ?? 0,
    createdCount: toNum(state.stats && state.stats.createdCount) ?? 0,
  };
  return s;
}

function loadState() {
  if (!storageAvailable) return defaultState();
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
  if (!raw) return defaultState();
  try {
    let state = JSON.parse(raw);
    const from = typeof state.version === 'number' ? state.version : 0;
    for (let v = from + 1; v <= CURRENT_VERSION; v++) {
      if (MIGRATIONS[v]) state = MIGRATIONS[v](state);
    }
    return normalize(state);
  } catch (e) {
    return defaultState(); // 数据损坏则重置，不崩溃
  }
}

function saveState(state) {
  if (!storageAvailable) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    return false;
  }
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// HTML 转义，防 XSS（任务标题等用户输入）
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

window.Store = {
  TASK_TYPES,
  TASK_TYPE_KEYS,
  STORAGE_KEY,
  storageAvailable,
  loadState,
  saveState,
  genId,
  escapeHtml,
};
