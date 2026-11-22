(function () {
  'use strict';

  window.AuthApp = {
    async login(email, password) {
      try {
        const user = await Storage.authenticate(email, password);
        if (!user) return { ok: false, message: 'الإيميل أو كلمة المرور غير صحيحة، أو الحساب غير نشط.' };
        return { ok: true, user };
      } catch (error) {
        console.error(error);
        return { ok: false, message: 'تعذر الاتصال بقاعدة البيانات. راجع إعدادات Supabase.' };
      }
    },
    async logout() {
      await Storage.clearCurrentUser();
      window.App?.showLogin();
    },
    guard(role) {
      const user = Storage.getCurrentUser();
      return user && user.isActive && (!role || user.role === role) ? user : null;
    }
  };
})();
