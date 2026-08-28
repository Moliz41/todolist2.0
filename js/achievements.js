'use strict';

/* ============================================================
 * achievements.js — 成就徽章定义与判定（纯数据/逻辑，不碰 DOM）
 * 依赖：无（需在 app.js 之前加载）
 * 暴露：window.Badges
 * ============================================================ */

const BADGES = [
  { id: 'first',   name: '初次出征', icon: '⚔️', desc: '完成你的第一个任务',
    check: s => s.stats.totalCompleted >= 1 },
  { id: 'ten',     name: '十连捷报', icon: '🎖️', desc: '累计完成 10 个任务',
    check: s => s.stats.totalCompleted >= 10 },
  { id: 'fifty',   name: '五十连斩', icon: '🏆', desc: '累计完成 50 个任务',
    check: s => s.stats.totalCompleted >= 50 },
  { id: 'hundred', name: '百战不殆', icon: '👑', desc: '累计完成 100 个任务',
    check: s => s.stats.totalCompleted >= 100 },
  { id: 'daily5',  name: '日行千里', icon: '🚀', desc: '同一天内完成 5 个任务',
    check: s => maxSameDay(s.tasks) >= 5 },
  { id: 'sweep',   name: '全图制霸', icon: '🌍', desc: '所有任务同时全部完成',
    check: s => s.tasks.length > 0 && s.tasks.every(t => t.status === 'completed') },
  { id: 'oneshot', name: '一气呵成', icon: '⚡', desc: '一次操作把任务从 0 直接做到满',
    check: s => s.stats.oneshotHit === true },
  { id: 'builder', name: '目标设立者', icon: '🗺️', desc: '累计创建 20 个任务',
    check: s => s.stats.createdCount >= 20 },
];

// 统计「某本地日期内完成的任务数」的最大值（用于 daily5）
function maxSameDay(tasks) {
  const byDay = {};
  let best = 0;
  tasks.forEach(t => {
    if (t.status === 'completed' && t.completedAt) {
      const d = new Date(t.completedAt);
      const key = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
      byDay[key] = (byDay[key] || 0) + 1;
      if (byDay[key] > best) best = byDay[key];
    }
  });
  return best;
}

// 返回本次应解锁（尚未解锁且条件满足）的徽章列表
function evaluateBadges(state) {
  return BADGES.filter(b => !state.achievements[b.id] && b.check(state));
}

window.Badges = { BADGES, evaluateBadges };
