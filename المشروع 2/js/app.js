(function () {
  'use strict';

  window.mainContent = document.getElementById('main-content');
  const statusLabels = {
    pending: 'معلق',
    processing: 'قيد المعالجة',
    delivering: 'قيد التوصيل',
    completed: 'مكتمل',
    cancelled: 'ملغي'
  };
  const routes = {
    admin: {
      dashboard: () => AdminApp.showDashboard(),
      orders: () => AdminApp.showOrders(),
      add: () => AdminApp.showAddOrder(),
      marketers: () => ManageApp.showMarketers(),
      products: () => ManageApp.showProducts(),
      reports: () => ChartsApp.showReports()
    },
    marketer: {
      dashboard: () => MarketerApp.showDashboard(),
      orders: () => MarketerApp.showOrders(),
      add: () => MarketerApp.showAddOrder()
    }
  };

  window.escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
  window.escapeAttr = value => escapeHTML(value).replace(/\n/g, ' ');
  window.formatCurrency = value => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  window.formatDate = value => {
    try { return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
    catch (error) { return '—'; }
  };
  window.statusBadge = status => `<span class="badge ${status}">${statusLabels[status] || status}</span>`;
  window.detail = (name, value) => `<div class="detail-row"><span>${escapeHTML(name)}</span><b>${typeof value === 'string' && value.includes('badge') ? value : escapeHTML(value)}</b></div>`;
  window.pagination = (current, pages, prefix) => {
    let html = `<div class="pagination"><button class="page-btn" data-${prefix}="1" ${current === 1 ? 'disabled' : ''}>السابق</button>`;
    for (let page = 1; page <= pages; page += 1) html += `<button class="page-btn ${current === page ? 'active' : ''}" data-${prefix}="${page}">${page}</button>`;
    return `${html}<button class="page-btn" data-${prefix}="${pages}" ${current === pages ? 'disabled' : ''}>التالي</button></div>`;
  };

  let toastTimer;
  window.showToast = (message, type = 'success') => {
    const element = document.getElementById('toast');
    element.textContent = message;
    element.className = `toast ${type} show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('show'), 3000);
  };
  window.showLoading = visible => document.getElementById('loading').classList.toggle('hidden', !visible);
  window.openModal = (title, content) => {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-content').innerHTML = content;
    document.getElementById('modal-overlay').classList.remove('hidden');
  };
  window.closeModal = () => document.getElementById('modal-overlay').classList.add('hidden');

  window.App = {
    showLogin() {
      document.getElementById('app-screen').classList.add('hidden');
      document.getElementById('login-screen').classList.remove('hidden');
      document.getElementById('password').value = '';
      document.getElementById('username').focus();
    },
    showApp(user) {
      if (!user || !user.isActive) return this.showLogin();
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('app-screen').classList.remove('hidden');
      document.getElementById('nav-user-name').textContent = user.name;
      document.getElementById('nav-user-role').textContent = user.role === 'admin' ? 'مسؤول النظام' : 'مسوّق';
      document.getElementById('nav-avatar').textContent = user.name?.charAt(0) || 'م';
      this.buildNav(user.role);
      this.route('dashboard');
    },
    buildNav(role) {
      const nav = document.getElementById('main-nav');
      const items = role === 'admin'
        ? [['dashboard', '📊', 'لوحة التحكم'], ['orders', '📦', 'الأوردرات'], ['add', '＋', 'إضافة أوردر'], ['marketers', '👥', 'المسوقون'], ['products', '🛍️', 'المنتجات'], ['reports', '📈', 'التقارير']]
        : [['dashboard', '📊', 'لوحة التحكم'], ['orders', '📦', 'الأوردرات'], ['add', '＋', 'إضافة أوردر']];
      nav.innerHTML = items.map(([view, icon, label]) => `<a href="#" class="nav-link" data-view="${view}"><span class="nav-icon">${icon}</span>${label}</a>`).join('');
      nav.querySelectorAll('[data-view]').forEach(link => {
        link.onclick = event => { event.preventDefault(); this.route(link.dataset.view); this.closeSidebar(); };
      });
    },
    route(view) {
      const user = Storage.getCurrentUser();
      if (!user || !user.isActive) return this.showLogin();
      document.querySelectorAll('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.view === view));
      const handler = routes[user.role]?.[view] || routes[user.role]?.dashboard;
      try { handler?.(); }
      catch (error) {
        console.error(error);
        mainContent.innerHTML = '<div class="card"><div class="empty-state"><div class="empty-icon">⚠️</div>حدث خطأ غير متوقع. حاول تحديث الصفحة.</div></div>';
      }
    },
    closeSidebar() {
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebar-backdrop').classList.remove('show');
    }
  };

  document.addEventListener('DOMContentLoaded', async () => {
    await window.StorageReady;
    const loginForm = document.getElementById('login-form');
    loginForm.onsubmit = async event => {
      event.preventDefault();
      const email = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      const errorElement = document.getElementById('login-error');
      showLoading(true);
      const result = await AuthApp.login(email, password);
      showLoading(false);
      if (!result.ok) { errorElement.textContent = result.message; return; }
      errorElement.textContent = '';
      App.showApp(result.user);
    };
    document.getElementById('logout-btn').onclick = async () => {
      if (confirm('هل تريد تسجيل الخروج؟')) await AuthApp.logout();
    };
    document.getElementById('modal-close').onclick = closeModal;
    document.getElementById('modal-overlay').onclick = event => { if (event.target.id === 'modal-overlay') closeModal(); };
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
    document.getElementById('sidebar-toggle').onclick = () => document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-backdrop').onclick = () => App.closeSidebar();
    document.getElementById('theme-toggle').onclick = () => {
      document.body.classList.toggle('dark');
      localStorage.setItem('oms_theme', document.body.classList.contains('dark') ? 'dark' : 'light');
    };
    if (localStorage.getItem('oms_theme') === 'dark') document.body.classList.add('dark');
    const session = Storage.getCurrentUser();
    if (session) App.showApp(session); else App.showLogin();
  });
})();
