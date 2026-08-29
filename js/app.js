'use strict';

/* ============================================================
 * app.js — 控制器
 * 职责：状态持有、渲染、事件绑定、交互流程
 * 依赖：store.js（Store / TASK_TYPES / TASK_TYPE_KEYS）、
 *       achievements.js（Badges）
 * 核心模式：单一状态源 + 全量重渲染 + 事件委托
 * ============================================================ */

const App = (() => {
  // ---------- 状态 ----------
  let state = Store.loadState();
  let currentTab = 'active';   // 'active' | 'archive'
  let customOpenId = null;     // 展开自定义进度输入框的任务 id
  let editingId = null;        // 正在编辑的任务 id（null = 新建）
  let formType = 'main';       // 表单中选中的类型

  // ---------- DOM ----------
  let el = {};
  function cacheDom() {
    el.warning = document.getElementById('storage-warning');
    el.statCompleted = document.getElementById('stat-completed');
    el.statActive = document.getElementById('stat-active');
    el.badgeCount = document.getElementById('badge-count');
    el.btnAchievements = document.getElementById('btn-achievements');
    el.achOverlay = document.getElementById('achievements-overlay');
    el.achList = document.getElementById('ach-list');
    el.achCount = document.getElementById('ach-count');
    el.achClose = document.getElementById('ach-close');
    el.btnNew = document.getElementById('btn-new');
    el.tabs = document.querySelectorAll('.tab');
    el.body = document.getElementById('body');
    el.toasts = document.getElementById('toasts');

    el.modal = document.getElementById('modal');
    el.modalTitle = document.getElementById('modal-title');
    el.form = document.getElementById('task-form');
    el.fTitle = document.getElementById('f-title');
    el.fTarget = document.getElementById('f-target');
    el.fStartWrap = document.getElementById('f-start-wrap');
    el.fStart = document.getElementById('f-start');
    el.fDestination = document.getElementById('f-destination');
    el.fStartTime = document.getElementById('f-start-time');
    el.fEndTime = document.getElementById('f-end-time');
    el.typePicker = document.getElementById('f-type');
    el.fCancel = document.getElementById('f-cancel');

    el.confirm = document.getElementById('confirm');
    el.confirmText = document.getElementById('confirm-text');
    el.confirmYes = document.getElementById('confirm-yes');
    el.confirmNo = document.getElementById('confirm-no');
  }

  // ---------- 工具 ----------
  function findTask(id) { return state.tasks.find(t => t.id === id); }
  function pad(n) { return String(n).padStart(2, '0'); }
  // 时间格式化：datetime-local 字符串 → 本地时间显示
  function fmtMDHM(val) { const d = new Date(val); if (isNaN(d.getTime())) return null; return `${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  function fmtHM(val) { const d = new Date(val); if (isNaN(d.getTime())) return null; return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  // 任务卡片时间行：两个都填→同天压缩；只填一个→只显示对应部分；都没填→空串
  function timeRowHTML(t) {
    const ds = t.startTime ? new Date(t.startTime) : null;
    const de = t.endTime ? new Date(t.endTime) : null;
    const sOk = ds && !isNaN(ds.getTime());
    const eOk = de && !isNaN(de.getTime());
    if (!sOk && !eOk) return '';
    let txt;
    if (sOk && eOk) {
      const sameDay = ds.getFullYear() === de.getFullYear() && ds.getMonth() === de.getMonth() && ds.getDate() === de.getDate();
      txt = sameDay ? `${fmtMDHM(t.startTime)} → ${fmtHM(t.endTime)}` : `${fmtMDHM(t.startTime)} → ${fmtMDHM(t.endTime)}`;
    } else if (sOk) {
      txt = `${fmtMDHM(t.startTime)} 起`;
    } else {
      txt = `截止 ${fmtMDHM(t.endTime)}`;
    }
    return `<div class="task-time">🕒 ${txt}</div>`;
  }
  function nextOrder(type) {
    return state.tasks
      .filter(t => t.type === type && t.status === 'active')
      .reduce((m, t) => Math.max(m, t.order), 0) + 1;
  }

  // ---------- 成就 ----------
  function checkAchievements() {
    const unlocked = Badges.evaluateBadges(state);
    if (!unlocked.length) return;
    unlocked.forEach(b => { state.achievements[b.id] = true; });
    Store.saveState(state);
    unlocked.forEach(b => showToast(`🏅 成就解锁：${b.name}`, 'badge'));
  }

  // ---------- Toast ----------
  function showToast(msg, cls) {
    const t = document.createElement('div');
    t.className = 'toast' + (cls ? ' ' + cls : '');
    t.textContent = msg;
    el.toasts.appendChild(t);
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, 2600);
  }

  // ---------- 数据变更：进度 ----------
  function applyProgress(id, newValue) {
    const t = findTask(id);
    if (!t) return;
    const clamped = Math.max(0, Math.min(t.target, Math.floor(newValue)));
    if (clamped === t.progress) return;
    const oldProgress = t.progress;
    const oldStatus = t.status;
    t.progress = clamped;
    t.updatedAt = Date.now();

    if (oldStatus === 'active' && clamped >= t.target) {
      t.status = 'completed';
      t.completedAt = Date.now();
      state.stats.totalCompleted += 1;       // 累计计数不回退（恢复后再完成仍累计）
      if (oldProgress === 0) state.stats.oneshotHit = true;
      celebrate(t.title);
      showToast(`✓ 任务完成：「${t.title}」`, 'success');
    }
    Store.saveState(state);
    checkAchievements();
    render();
  }

  // ---------- 数据变更：其他 ----------
  function moveTask(id, dir) {
    const t = findTask(id);
    if (!t) return;
    const group = state.tasks
      .filter(x => x.type === t.type && x.status === 'active')
      .sort((a, b) => a.order - b.order);
    const idx = group.findIndex(x => x.id === id);
    const other = group[idx + dir];
    if (!other) return;
    const tmp = t.order; t.order = other.order; other.order = tmp;
    Store.saveState(state);
    render();
  }

  function restoreTask(id) {
    const t = findTask(id); if (!t) return;
    t.status = 'active';
    t.completedAt = null;
    t.updatedAt = Date.now();
    Store.saveState(state);
    checkAchievements();
    render();
  }

  function resetTask(id) {
    const t = findTask(id); if (!t) return;
    t.status = 'active';
    t.progress = 0;
    t.completedAt = null;
    t.updatedAt = Date.now();
    Store.saveState(state);
    render();
  }

  function requestDelete(id) {
    const t = findTask(id); if (!t) return;
    showConfirm(`确定删除任务「${t.title}」？此操作不可恢复。`, () => {
      state.tasks = state.tasks.filter(x => x.id !== id);
      Store.saveState(state);
      checkAchievements();
      render();
    });
  }

  function clearArchive() {
    const n = state.tasks.filter(t => t.status === 'completed').length;
    if (!n) return;
    showConfirm(`确定清空归档中的 ${n} 个任务？此操作不可恢复。`, () => {
      state.tasks = state.tasks.filter(t => t.status !== 'completed');
      Store.saveState(state);
      checkAchievements();
      render();
    });
  }

  // ---------- 完成庆祝特效 ----------
  function celebrate(title) {
    const flash = document.createElement('div');
    flash.className = 'screen-flash';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 650);

    const stamp = document.createElement('div');
    stamp.className = 'stamp';
    stamp.innerHTML = `
      <div class="stamp-check">✔</div>
      <div class="stamp-text">任务完成！</div>
      <div class="stamp-sub">${Store.escapeHtml(title)}</div>`;
    document.body.appendChild(stamp);
    setTimeout(() => {
      stamp.classList.add('out');
      setTimeout(() => stamp.remove(), 450);
    }, 1400);
  }

  // ---------- 渲染 ----------
  function render() {
    renderHeader();
    renderAchievementsButton();
    renderTabs();
    renderBody();
  }

  function renderHeader() {
    // 「已完成」直接统计当前已完成任务数，删除/恢复/清空归档时自然同步；累计完成次数(stats.totalCompleted)仅用于成就判定
    el.statCompleted.textContent = state.tasks.filter(t => t.status === 'completed').length;
    el.statActive.textContent = state.tasks.filter(t => t.status === 'active').length;
  }

  // 工具栏「成就」按钮上的计数
  function renderAchievementsButton() {
    const count = Badges.BADGES.filter(b => state.achievements[b.id]).length;
    el.badgeCount.textContent = `${count} / ${Badges.BADGES.length}`;
  }

  // 成就详情弹层：竖排列出各项成就 + 完成条件
  function renderAchievementsList() {
    const count = Badges.BADGES.filter(b => state.achievements[b.id]).length;
    el.achCount.textContent = `${count} / ${Badges.BADGES.length}`;
    el.achList.innerHTML = Badges.BADGES.map(b => {
      const unlocked = !!state.achievements[b.id];
      return `
        <div class="ach-item ${unlocked ? 'unlocked' : 'locked'}">
          <span class="ach-icon">${b.icon}</span>
          <div class="ach-body">
            <div class="ach-name">${unlocked ? b.name : '？？？'}</div>
            <div class="ach-desc">完成条件：${b.desc}</div>
          </div>
          <span class="ach-status">${unlocked ? '已解锁' : '未解锁'}</span>
        </div>`;
    }).join('');
  }

  function openAchievements() {
    renderAchievementsList();
    showOverlay(el.achOverlay);
  }

  function renderTabs() {
    el.tabs.forEach(tab => tab.classList.toggle('is-active', tab.dataset.tab === currentTab));
  }

  function renderBody() {
    if (currentTab === 'active') renderActive();
    else renderArchive();
  }

  function renderActive() {
    const active = state.tasks.filter(t => t.status === 'active');
    if (!active.length) {
      el.body.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🗺️</div>
          <p>暂无进行中的任务</p>
          <p class="empty-sub">点击「＋ 新建任务」开始你的冒险！</p>
        </div>`;
      return;
    }
    el.body.innerHTML = TASK_TYPE_KEYS.map(type => {
      const items = active.filter(t => t.type === type).sort((a, b) => a.order - b.order);
      return `
        <section class="group">
          <header class="group-head type-${type}">
            <span class="group-icon">${TASK_TYPES[type].icon}</span>
            <span class="group-name">${TASK_TYPES[type].label}</span>
            <span class="group-count">${items.length}</span>
          </header>
          ${items.length ? items.map(taskCardHTML).join('') : '<div class="group-empty">暂无任务</div>'}
        </section>`;
    }).join('');
  }

  function renderArchive() {
    const items = state.tasks
      .filter(t => t.status === 'completed')
      .sort((a, b) => b.completedAt - a.completedAt);
    if (!items.length) {
      el.body.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📜</div>
          <p>还没有已归档的任务</p>
          <p class="empty-sub">完成任务后会自动归档到这里</p>
        </div>`;
      return;
    }
    el.body.innerHTML = `
      <div class="archive-head">
        <span class="archive-title">📜 已完成任务（${items.length}）</span>
        <button class="btn btn-sm btn-danger" data-action="clear-archive">清空归档</button>
      </div>
      ${items.map(archiveCardHTML).join('')}`;
  }

  // ---------- 卡片模板 ----------
  function taskCardHTML(t) {
    const type = TASK_TYPES[t.type];
    const pct = Math.min(100, Math.round((t.progress / t.target) * 100));
    const custom = customOpenId === t.id ? `
      <div class="custom-row">
        <input type="number" class="custom-input" data-id="${t.id}" min="0" max="${t.target}" value="${t.progress}" placeholder="0 ~ ${t.target}">
        <button class="btn btn-sm btn-primary" data-action="set-progress" data-id="${t.id}">设置</button>
        <button class="btn btn-sm" data-action="custom-cancel">取消</button>
      </div>` : '';
    return `
    <article class="task-card type-${t.type}" data-card-id="${t.id}">
      <div class="task-card-head">
        <span class="type-icon">${type.icon}</span>
        <span class="type-tag">${type.label}</span>
        <span class="task-title">${Store.escapeHtml(t.title)}</span>
        ${t.destination ? `<span class="task-destination">→ ${Store.escapeHtml(t.destination)}</span>` : ''}
        <span class="task-progress-num">${t.progress} / ${t.target}</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      ${timeRowHTML(t)}
      ${custom}
      <div class="task-actions">
        <div class="quick-row">
          <button class="btn btn-sm btn-primary btn-add" data-action="add" data-step="1" data-id="${t.id}" title="完成一次">+1</button>
          <button class="btn btn-sm" data-action="finish" data-id="${t.id}" title="直接完成">完成</button>
          <button class="btn btn-sm" data-action="custom" data-id="${t.id}" title="自定义进度">自定义…</button>
        </div>
        <div class="meta-row">
          <button class="icon-btn" data-action="edit" data-id="${t.id}" title="编辑">✎</button>
          <button class="icon-btn" data-action="move-up" data-id="${t.id}" title="上移">▲</button>
          <button class="icon-btn" data-action="move-down" data-id="${t.id}" title="下移">▼</button>
          <button class="icon-btn danger" data-action="delete" data-id="${t.id}" title="删除">✕</button>
        </div>
      </div>
    </article>`;
  }

  function archiveCardHTML(t) {
    const type = TASK_TYPES[t.type];
    const d = new Date(t.completedAt);
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return `
    <article class="task-card archived-card type-${t.type}" data-card-id="${t.id}">
      <div class="task-card-head">
        <span class="type-icon">${type.icon}</span>
        <span class="type-tag">${type.label}</span>
        <span class="task-title">${Store.escapeHtml(t.title)}</span>
        ${t.destination ? `<span class="task-destination">→ ${Store.escapeHtml(t.destination)}</span>` : ''}
        <span class="task-done">✔ 已完成</span>
      </div>
      <div class="progress-track"><div class="progress-fill full" style="width:100%"></div></div>
      ${timeRowHTML(t)}
      <div class="task-actions">
        <div class="quick-row">
          <button class="btn btn-sm" data-action="restore" data-id="${t.id}" title="恢复为进行中，保留进度">恢复</button>
          <button class="btn btn-sm" data-action="reset" data-id="${t.id}" title="进度清零并恢复">重置进度</button>
          <button class="btn btn-sm btn-danger" data-action="delete" data-id="${t.id}" title="删除任务">删除</button>
        </div>
        <div class="meta-row"><span class="task-date">完成于 ${dateStr}</span></div>
      </div>
    </article>`;
  }

  // ---------- 表单 ----------
  function openForm(taskId) {
    editingId = taskId || null;
    const t = taskId ? findTask(taskId) : null;
    el.modalTitle.textContent = t ? '编辑任务' : '新建任务';
    el.fTitle.value = t ? t.title : '';
    formType = t ? t.type : 'main';
    el.fTarget.value = t ? t.target : 1;
    el.fStartWrap.hidden = !!t;              // 编辑时不显示起始进度
    el.fStart.value = 0;
    el.fDestination.value = t ? (t.destination || '') : '';
    el.fStartTime.value = t ? (t.startTime || '') : '';
    el.fEndTime.value = t ? (t.endTime || '') : '';
    el.fEndTime.classList.remove('input-error');
    el.typePicker.querySelectorAll('.type-opt').forEach(o =>
      o.classList.toggle('is-selected', o.classList.contains('type-' + formType)));
    showOverlay(el.modal);
    el.fTitle.focus();
  }

  function handleFormSubmit(e) {
    e.preventDefault();
    const title = el.fTitle.value.trim();
    if (!title) {
      el.fTitle.classList.add('input-error');
      el.fTitle.focus();
      return;
    }
    let target = parseInt(el.fTarget.value, 10);
    if (!Number.isFinite(target) || target < 1) {
      el.fTarget.classList.add('input-error');
      el.fTarget.focus();
      return;
    }
    target = Math.floor(target);
    const destination = el.fDestination.value.trim();
    const startTime = el.fStartTime.value || null;
    const endTime = el.fEndTime.value || null;
    // 软提示：结束早于开始时弹 toast，但不阻止保存
    if (startTime && endTime && new Date(endTime) < new Date(startTime)) {
      showToast('⚠️ 结束时间早于开始时间', 'badge');
    }

    if (editingId) {
      const t = findTask(editingId);
      if (t) {
        t.title = title;
        t.type = formType;
        t.target = target;
        t.destination = destination;
        t.startTime = startTime;
        t.endTime = endTime;
        t.updatedAt = Date.now();
        if (t.progress > target) t.progress = target;  // 目标调小时钳制进度
      }
    } else {
      let start = parseInt(el.fStart.value, 10);
      if (!Number.isFinite(start) || start < 0) start = 0;
      start = Math.min(start, target);
      const completed = start >= target;
      state.tasks.push({
        id: Store.genId(),
        title,
        type: formType,
        destination,
        startTime,
        endTime,
        progress: start,
        target,
        status: completed ? 'completed' : 'active',
        order: nextOrder(formType),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        completedAt: completed ? Date.now() : null,
      });
      state.stats.createdCount += 1;
      if (completed) state.stats.totalCompleted += 1;
    }
    Store.saveState(state);
    checkAchievements();
    hideOverlay(el.modal);
    render();
  }

  // ---------- 确认弹层 ----------
  function showConfirm(message, onYes) {
    el.confirmText.textContent = message;
    el.confirmYes.onclick = () => { hideOverlay(el.confirm); onYes(); };
    el.confirmNo.onclick = () => hideOverlay(el.confirm);
    showOverlay(el.confirm);
  }

  // ---------- 弹层显隐 ----------
  function showOverlay(overlay) {
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('open'));
  }
  function hideOverlay(overlay) {
    overlay.classList.remove('open');
    setTimeout(() => { if (!overlay.classList.contains('open')) overlay.hidden = true; }, 200);
  }

  // ---------- 事件绑定 ----------
  function bindEvents() {
    el.btnNew.addEventListener('click', () => openForm(null));
    el.fCancel.addEventListener('click', () => hideOverlay(el.modal));
    el.form.addEventListener('submit', handleFormSubmit);
    el.modal.addEventListener('mousedown', (e) => { if (e.target === el.modal) hideOverlay(el.modal); });
    el.confirm.addEventListener('mousedown', (e) => { if (e.target === el.confirm) hideOverlay(el.confirm); });
    el.btnAchievements.addEventListener('click', openAchievements);
    el.achClose.addEventListener('click', () => hideOverlay(el.achOverlay));
    el.achOverlay.addEventListener('mousedown', (e) => { if (e.target === el.achOverlay) hideOverlay(el.achOverlay); });

    el.typePicker.addEventListener('click', (e) => {
      const opt = e.target.closest('.type-opt');
      if (!opt) return;
      formType = opt.classList.contains('type-main') ? 'main' : 'side';
      el.typePicker.querySelectorAll('.type-opt').forEach(o =>
        o.classList.toggle('is-selected', o === opt));
    });

    el.tabs.forEach(tab => tab.addEventListener('click', () => {
      currentTab = tab.dataset.tab;
      render();
    }));

    el.body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      switch (action) {
        case 'add': {
          const t = findTask(id); if (!t) break;
          const step = btn.dataset.step;
          const delta = step === 'pct' ? Math.max(1, Math.round(t.target * 0.25)) : parseInt(step, 10);
          applyProgress(id, t.progress + delta);
          break;
        }
        case 'minus': { const t = findTask(id); if (t) applyProgress(id, t.progress - 1); break; }
        case 'finish': { const t = findTask(id); if (t) applyProgress(id, t.target); break; }
        case 'set-progress': {
          const t = findTask(id); if (!t) break;
          const input = el.body.querySelector(`.custom-input[data-id="${id}"]`);
          if (!input) break;
          const val = parseInt(input.value, 10);
          if (Number.isFinite(val)) {
            customOpenId = null;
            applyProgress(id, val);
            render();   // 确保输入框关闭（applyProgress 无变化时也会渲染）
          }
          break;
        }
        case 'custom':
          customOpenId = id;
          render();
          requestAnimationFrame(() => {
            const input = el.body.querySelector(`.custom-input[data-id="${id}"]`);
            if (input) { input.focus(); input.select(); }
          });
          break;
        case 'custom-cancel': customOpenId = null; render(); break;
        case 'edit': openForm(id); break;
        case 'move-up': moveTask(id, -1); break;
        case 'move-down': moveTask(id, 1); break;
        case 'delete': requestDelete(id); break;
        case 'restore': restoreTask(id); break;
        case 'reset': resetTask(id); break;
        case 'clear-archive': clearArchive(); break;
      }
    });

    el.body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const input = e.target.closest('.custom-input');
        if (input) {
          e.preventDefault();
          const setBtn = input.parentElement.querySelector('[data-action="set-progress"]');
          if (setBtn) setBtn.click();
        }
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (customOpenId) { customOpenId = null; render(); return; }
      if (!el.achOverlay.hidden) { hideOverlay(el.achOverlay); return; }
      if (!el.modal.hidden) { hideOverlay(el.modal); return; }
      if (!el.confirm.hidden) { hideOverlay(el.confirm); }
    });

    // 输入出错后重新输入时清除错误态
    [el.fTitle, el.fTarget, el.fStart].forEach(inp =>
      inp.addEventListener('input', () => inp.classList.remove('input-error')));
    // 时间软校验：结束早于开始时给结束框红框，不阻止保存
    function syncTimeError() {
      const s = el.fStartTime.value, e = el.fEndTime.value;
      el.fEndTime.classList.toggle('input-error', !!(s && e && new Date(e) < new Date(s)));
    }
    el.fStartTime.addEventListener('input', syncTimeError);
    el.fEndTime.addEventListener('input', syncTimeError);
  }

  // ---------- 入口 ----------
  function init() {
    cacheDom();
    if (!Store.storageAvailable) {
      el.warning.hidden = false;
      showToast('⚠️ 浏览器存储不可用，数据将不会保存', 'badge');
    }
    bindEvents();
    checkAchievements();
    render();
  }

  init();
})();
