(function () {
  'use strict';

  const client = window.supabaseClient;
  const STATUS = ['pending', 'processing', 'delivering', 'completed', 'cancelled'];
  const state = { currentUser: null, users: [], products: [], orders: [], ready: false };
  let initPromise;

  const orderTotal = order => Number(order.salePrice || 0) * Number(order.quantity || 1);
  const orderCost = order => Number(order.costPrice || 0) * Number(order.quantity || 1);
  const money = value => Number(value || 0);
  const orderDisplayId = row => row.legacy_id || `ORD-${String(row.order_no || '').padStart(4, '0')}`;

  const toUser = row => row ? ({
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at
  }) : null;

  const toProduct = row => row ? ({
    id: row.id,
    legacyId: row.legacy_id,
    name: row.name,
    salePrice: money(row.sale_price),
    costPrice: money(row.cost_price),
    createdAt: row.created_at,
    isActive: row.is_active !== false
  }) : null;

  const toOrder = row => {
    if (!row) return null;
    const marketer = state.users.find(user => user.id === row.marketer_id);
    return {
      id: orderDisplayId(row),
      dbId: row.id,
      legacyId: row.legacy_id,
      orderNo: row.order_no,
      clientName: row.client_name,
      clientPhone: row.client_phone,
      clientAddress: row.client_address,
      productId: row.product_id,
      productName: row.product_name || row.product_name_snapshot,
      quantity: Number(row.quantity || 1),
      salePrice: money(row.sale_price),
      costPrice: money(row.cost_price),
      profit: row.total_profit != null
        ? money(row.total_profit) / Math.max(1, Number(row.quantity || 1))
        : money(row.profit),
      status: row.status,
      marketerId: row.marketer_id,
      marketerName: marketer?.name || (state.currentUser?.id === row.marketer_id ? state.currentUser.name : ''),
      notes: row.notes || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  };

  function setError(error) {
    state.lastError = error instanceof Error ? error : new Error(String(error || 'Unknown error'));
    console.error('[Supabase]', state.lastError);
  }

  async function getProfile(userId) {
    const { data, error } = await client
      .from('profiles')
      .select('id,name,username,role,is_active,created_at')
      .eq('id', userId)
      .single();
    if (error) throw error;
    return toUser(data);
  }

  async function loadData() {
    if (!state.currentUser) {
      state.users = [];
      state.products = [];
      state.orders = [];
      return;
    }

    const isAdmin = state.currentUser.role === 'admin';
    const usersRequest = isAdmin
      ? client.from('profiles').select('id,name,username,role,is_active,created_at').order('created_at')
      : Promise.resolve({ data: [state.currentUser], error: null });
    const productsRequest = client
      .from(isAdmin ? 'products_for_admin' : 'products_for_marketers')
      .select('*')
      .order('name');
    const [usersResult, productsResult] = await Promise.all([usersRequest, productsRequest]);
    if (usersResult.error) throw usersResult.error;
    if (productsResult.error) throw productsResult.error;

    state.users = (usersResult.data || []).map(row => row.id ? toUser(row) : row).filter(Boolean);
    state.products = (productsResult.data || []).map(toProduct).filter(Boolean);

    const { data: orderRows, error: ordersError } = await client
      .from(isAdmin ? 'orders_for_admin' : 'orders_for_marketers')
      .select('*')
      .order('created_at', { ascending: false });
    if (ordersError) throw ordersError;
    state.orders = (orderRows || []).map(toOrder).filter(Boolean);
  }

  async function refresh() {
    await loadData();
    state.ready = true;
    return state.currentUser;
  }

  async function ensureReady() {
    if (!state.ready) await (initPromise || init());
  }

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (data.session?.user) {
        state.currentUser = await getProfile(data.session.user.id);
        if (!state.currentUser?.isActive) {
          await client.auth.signOut();
          state.currentUser = null;
        }
      }
      await refresh();
      return state.currentUser;
    })().catch(error => {
      setError(error);
      state.ready = true;
      state.currentUser = null;
      state.users = [];
      state.products = [];
      state.orders = [];
      return null;
    });
    return initPromise;
  }

  async function authenticate(email, password) {
    await ensureReady();
    const { data, error } = await client.auth.signInWithPassword({ email: String(email || '').trim(), password });
    if (error || !data.user) return null;
    const profile = await getProfile(data.user.id);
    if (!profile?.isActive) {
      await client.auth.signOut();
      return null;
    }
    state.currentUser = profile;
    await refresh();
    return profile;
  }

  async function clearCurrentUser() {
    await client.auth.signOut();
    state.currentUser = null;
    state.users = [];
    state.products = [];
    state.orders = [];
  }

  async function addProduct(data) {
    const { error } = await client.from('products').insert({
      name: String(data.name || '').trim(),
      sale_price: money(data.salePrice),
      cost_price: money(data.costPrice)
    });
    if (error) throw error;
    await refresh();
    return state.products.find(product => product.name === String(data.name || '').trim()) || null;
  }

  async function updateProduct(productId, updates) {
    const { error } = await client.from('products').update({
      name: String(updates.name || '').trim(),
      sale_price: money(updates.salePrice),
      cost_price: money(updates.costPrice),
      is_active: updates.isActive !== false
    }).eq('id', productId);
    if (error) throw error;
    await refresh();
    return state.products.find(product => product.id === productId) || null;
  }

  async function deleteProduct(productId) {
    const { error } = await client.from('products').update({ is_active: false }).eq('id', productId);
    if (error) throw error;
    await refresh();
    return true;
  }

  async function addOrder(data) {
    const { data: row, error } = await client.rpc('create_order', {
      p_client_name: String(data.clientName || '').trim(),
      p_client_phone: String(data.clientPhone || '').trim(),
      p_client_address: String(data.clientAddress || '').trim(),
      p_product_id: data.productId,
      p_quantity: Math.max(1, Number(data.quantity) || 1),
      p_notes: String(data.notes || '').trim(),
      p_marketer_id: state.currentUser?.role === 'admin' ? (data.marketerId || null) : null,
      p_sale_price: state.currentUser?.role === 'admin' && data.salePrice !== '' && data.salePrice != null
        ? money(data.salePrice)
        : null
    });
    if (error) throw error;
    await refresh();
    return toOrder(row);
  }

  async function updateOrder(orderId, updates) {
    const current = state.orders.find(order => order.id === orderId || order.dbId === orderId);
    if (!current) return null;
    const { data: row, error } = await client.rpc('update_order', {
      p_order_id: current.dbId,
      p_client_name: updates.clientName ?? null,
      p_client_phone: updates.clientPhone ?? null,
      p_client_address: updates.clientAddress ?? null,
      p_notes: updates.notes ?? null,
      p_status: updates.status ?? null,
      p_product_id: updates.productId ?? null,
      p_quantity: updates.quantity != null ? Number(updates.quantity) : null,
      p_sale_price: updates.salePrice != null ? money(updates.salePrice) : null,
      p_cost_price: updates.costPrice != null ? money(updates.costPrice) : null
    });
    if (error) throw error;
    await refresh();
    return toOrder(row);
  }

  async function deleteOrder(orderId) {
    const current = state.orders.find(order => order.id === orderId || order.dbId === orderId);
    if (!current) return false;
    const { error } = await client.rpc('delete_order', { p_order_id: current.dbId });
    if (error) throw error;
    await refresh();
    return true;
  }

  async function adminUserAction(action, payload = {}) {
    const { data, error } = await client.functions.invoke('admin-manage-user', {
      body: { action, ...payload }
    });
    if (error) throw error;
    await refresh();
    return data;
  }

  async function addUser(data) {
    return adminUserAction('create', {
      name: String(data.name || '').trim(),
      username: String(data.username || '').trim(),
      email: String(data.email || '').trim(),
      password: data.password,
      role: 'marketer'
    });
  }

  async function updateUser(userId, updates) {
    return adminUserAction('update', {
      userId,
      name: updates.name,
      username: updates.username,
      isActive: updates.isActive,
      password: updates.password
    });
  }

  async function toggleUserStatus(userId) {
    return adminUserAction('toggle', { userId });
  }

  async function deleteUser(userId) {
    return adminUserAction('deactivate', { userId });
  }

  function getUserByUsername(username) {
    return state.users.find(user => user.username?.toLowerCase() === String(username || '').trim().toLowerCase()) || null;
  }

  function getStats() {
    const orders = state.orders;
    return {
      totalOrders: orders.length,
      totalRevenue: orders.reduce((sum, order) => sum + orderTotal(order), 0),
      totalCost: orders.reduce((sum, order) => sum + orderCost(order), 0),
      totalProfit: orders.reduce((sum, order) => sum + Number(order.profit || 0) * Number(order.quantity || 1), 0),
      completedOrders: orders.filter(order => order.status === 'completed').length,
      pendingOrders: orders.filter(order => order.status === 'pending').length,
      cancelledOrders: orders.filter(order => order.status === 'cancelled').length,
      activeMarketers: state.users.filter(user => user.role === 'marketer' && user.isActive).length
    };
  }

  function getMarketerStats(marketerId) {
    const orders = state.orders.filter(order => order.marketerId === marketerId);
    return {
      totalOrders: orders.length,
      completedOrders: orders.filter(order => order.status === 'completed').length,
      pendingOrders: orders.filter(order => order.status === 'pending').length,
      totalRevenue: orders.reduce((sum, order) => sum + orderTotal(order), 0),
      totalProfit: orders.reduce((sum, order) => sum + Number(order.profit || 0) * Number(order.quantity || 1), 0)
    };
  }

  window.Storage = {
    STATUS,
    init,
    getCurrentUser: () => state.currentUser,
    setCurrentUser: () => {},
    clearCurrentUser,
    authenticate,
    getUsers: () => state.users,
    getUserByUsername,
    addUser,
    updateUser,
    toggleUserStatus,
    deleteUser,
    getProducts: () => state.products.filter(product => product.isActive),
    addProduct,
    updateProduct,
    deleteProduct,
    getOrders: () => state.orders,
    getOrdersByMarketer: marketerId => state.orders.filter(order => order.marketerId === marketerId),
    getOrdersForMarketerView: marketerId => state.orders
      .filter(order => order.marketerId === marketerId)
      .map(({ costPrice, profit, dbId, ...visible }) => visible),
    getOrderForMarketerView: orderId => {
      const order = state.orders.find(item => item.id === orderId || item.dbId === orderId);
      if (!order || (state.currentUser?.role === 'marketer' && order.marketerId !== state.currentUser.id)) return null;
      const { costPrice, profit, dbId, ...visible } = order;
      return visible;
    },
    addOrder,
    updateOrder,
    deleteOrder,
    getStats,
    getMarketerStats
  };

  window.StorageReady = init();
})();
