const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const clientKey = 'pedeia-client-profile-v1';
const stateKey = 'pedeia-state-v1';
const sessionKey = 'pedeia-session-v1';
let currentAuthTab = 'register';

let currentUser = null;
let currentSession = null;

const weekDays = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

function defaultShopSchedule() {
  return {
    Segunda: { enabled: true, open: '11:00', close: '22:00' },
    Terça: { enabled: true, open: '11:00', close: '22:00' },
    Quarta: { enabled: true, open: '11:00', close: '22:00' },
    Quinta: { enabled: true, open: '11:00', close: '22:00' },
    Sexta: { enabled: true, open: '11:00', close: '23:00' },
    Sábado: { enabled: true, open: '10:00', close: '23:00' },
    Domingo: { enabled: false, open: '12:00', close: '20:00' }
  };
}

const blank = {
  view: 'dashboard',
  customerView: 'menu',
  chatConversation: null,
  merchant: null,
  shop: null,
  categories: [],
  products: [],
  orders: [],
  ratings: [],
  messages: [],
  cart: [],
  orderQuery: '',
  orderFilter: '',
  delivery: {
    pickup: true,
    delivery: true,
    pickupMinutes: 20,
    deliveryMinutes: 45,
    autoAccept: false
  },
  printerConfig: {
    tab: 'list',
    mode: 'cabo',
    deviceName: 'Impressora térmica padrão',
    copies: 1,
    autoPrint: true,
    includeCustomer: true,
    includePhone: true,
    includeAddress: true,
    includeItems: true,
    includeNotes: true,
    includePayment: true,
    includeFooter: true,
    footerText: 'Obrigado pela preferência!'
  },
  printers: [
    { id: 'default', name: 'Impressora térmica local', type: 'cabo', status: 'Conectada', default: true }
  ]
};

let state = readState();

function fingerprint(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function readState() {
  try {
    const stored = JSON.parse(localStorage.getItem(stateKey) || 'null');
    return { ...blank, ...(stored || {}) };
  } catch {
    return structuredClone(blank);
  }
}

async function syncServerState() {
  // Para comerciantes autenticados, o Supabase e a fonte oficial dos dados.
  // O estado local do servidor pode estar vazio ou ser efemero depois de um deploy.
  if (currentUser) return false;

  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) return;
    const serverState = await response.json();
    if (!serverState || !Object.keys(serverState).length) return;

    // A aba atual e os filtros pertencem à navegação local, não ao estado compartilhado.
    // Preservá-los evita que o refresh do servidor reabra a aba anterior durante um clique.
    const localView = state.view;
    const localCustomerView = state.customerView;
    const localOrderQuery = state.orderQuery;
    const localOrderFilter = state.orderFilter;
    const localShopSettingsTab = state.shopSettingsTab;
    const localPrinterTab = state.printerConfig?.tab;
    const merged = {
      ...state,
      ...serverState,
      view: localView,
      customerView: localCustomerView,
      orderQuery: localOrderQuery,
      orderFilter: localOrderFilter,
      shopSettingsTab: localShopSettingsTab,
      printerConfig: {
        ...state.printerConfig,
        ...(serverState.printerConfig || {}),
        tab: localPrinterTab || state.printerConfig?.tab
      }
    };
    if (merchantLogged()) {
      if (!serverState.merchant) merged.merchant = state.merchant;
      if (!serverState.shop) merged.shop = state.shop;
    }
    if (fingerprint(state) !== fingerprint(merged)) {
      state = merged;
      localStorage.setItem(stateKey, JSON.stringify(merged));
      render();
      return true;
    }
    return false;
  } catch {
    // sem acesso ao servidor: continua localmente
  }
}

async function loadFromServer() {
  try {
    const response = await fetch('/api/state');
    if (!response.ok) return;
    const serverState = await response.json();
    if (serverState && Object.keys(serverState).length) {
      const merged = { ...blank, ...serverState };
      state = merged;
      localStorage.setItem(stateKey, JSON.stringify(merged));
    }
  } catch {
    // sem fallback de rede: continua usando localStorage
  }
}

function save() {
  try {
    localStorage.setItem(stateKey, JSON.stringify(state));
  } catch {
    // ignore storage quota issues
  }

  try {
    fetch('/api/save-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    }).catch(() => {});
  } catch {
    // ignore network failures
  }

  void persistStateToSupabase();
}

let supabaseSaveInProgress = false;

async function persistStateToSupabase() {
  if (supabaseSaveInProgress || !currentUser || !state.shop?.id || typeof supabaseClient === 'undefined') return;
  supabaseSaveInProgress = true;

  try {
    const categoryRows = state.categories.map((name, index) => ({
      loja_id: state.shop.id,
      nome: name,
      ordem: index
    }));

    if (categoryRows.length) {
      const { error } = await supabaseClient
        .from('categorias')
        .upsert(categoryRows, { onConflict: 'loja_id,nome' });
      if (error) console.error('Erro ao salvar categorias no Supabase:', error);
    }

    const { data: categories, error: categoryError } = await supabaseClient
      .from('categorias')
      .select('id, nome')
      .eq('loja_id', state.shop.id);

    if (categoryError) {
      console.error('Erro ao carregar categorias do Supabase:', categoryError);
      return;
    }

    const categoryIds = new Map(categories.map((category) => [category.nome, category.id]));
    const productRows = state.products
      .filter((product) => categoryIds.has(product.category))
      .map((product) => ({
        ...(isUuid(product.id) ? { id: product.id } : {}),
        loja_id: state.shop.id,
        categoria_id: categoryIds.get(product.category),
        nome: product.name,
        descricao: product.description || '',
        foto_url: product.photo || null,
        preco: Number(product.price || 0),
        disponivel: product.available !== false
      }));

    if (productRows.length) {
      const { data: savedProducts, error } = await supabaseClient
        .from('produtos')
        .upsert(productRows)
        .select('id, nome');
      if (error) console.error('Erro ao salvar produtos no Supabase:', error);
      if (savedProducts) {
        savedProducts.forEach((savedProduct) => {
          const localProduct = state.products.find((product) => product.name === savedProduct.nome);
          if (localProduct) localProduct.id = savedProduct.id;
        });
      }
    }
  } finally {
    supabaseSaveInProgress = false;
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function persistOrderToSupabase(order) {
  if (!state.shop?.id || typeof supabaseClient === 'undefined') return;

  const { data: savedOrder, error } = await supabaseClient
    .from('pedidos')
    .insert({
      loja_id: state.shop.id,
      cliente_nome: order.customer,
      cliente_telefone: order.phone,
      modalidade: order.fulfillment,
      endereco: order.address || null,
      pagamento: order.payment,
      observacoes: order.notes || null,
      total: order.total,
      status: order.status
    })
    .select('id')
    .single();

  if (error) {
    console.error('Erro ao salvar pedido no Supabase:', error);
    notify('Pedido salvo localmente, mas não foi enviado ao banco.');
    return;
  }

  order.supabaseId = savedOrder.id;
  const items = (order.items || []).map((item) => ({
    pedido_id: savedOrder.id,
    produto_id: isUuid(item.id) ? item.id : null,
    nome_produto: item.name,
    descricao_produto: item.description || '',
    quantidade: item.quantity,
    preco_unitario: item.price,
    observacao: item.notes || null
  }));

  if (items.length) {
    const { error: itemError } = await supabaseClient.from('itens_do_pedido').insert(items);
    if (itemError) console.error('Erro ao salvar itens do pedido:', itemError);
  }
}

async function updateOrderInSupabase(order) {
  if (!order?.supabaseId || typeof supabaseClient === 'undefined') return;
  const { error } = await supabaseClient
    .from('pedidos')
    .update({
      status: order.status,
      updated_at: new Date().toISOString(),
      pronto_em: ['Pronto', 'Saiu para entrega', 'Entregue'].includes(order.status) ? new Date().toISOString() : null
    })
    .eq('id', order.supabaseId);
  if (error) console.error('Erro ao atualizar pedido no Supabase:', error);
}

async function persistMessageToSupabase(message, orderId = null) {
  if (typeof supabaseClient === 'undefined') return;
  const { data, error } = await supabaseClient.from('mensagens').insert({
    pedido_id: orderId,
    remetente_id: currentUser?.id || null,
    tipo_remetente: message.from,
    mensagem: message.text,
    vista_pelo_comerciante: message.vistaPeloComerciante || false,
    vista_pelo_cliente: message.vistaPeloCliente || false,
    fixada: Boolean(message.fixada)
  }).select('id').single();
  if (error) console.error('Erro ao salvar mensagem no Supabase:', error);
  if (data?.id) {
    message.id = data.id;
    save();
  }
}

async function updateMessageInSupabase(message, updates) {
  if (!isUuid(message?.id) || typeof supabaseClient === 'undefined') return true;
  const { error } = await supabaseClient.from('mensagens').update(updates).eq('id', message.id);
  if (error) {
    console.error('Erro ao atualizar mensagem no Supabase:', error);
    notify('Não foi possível atualizar esta mensagem no banco.');
    return false;
  }
  return true;
}

async function deleteMessageFromSupabase(message) {
  if (!isUuid(message?.id) || typeof supabaseClient === 'undefined') return true;
  const { error } = await supabaseClient.from('mensagens').delete().eq('id', message.id);
  if (error) {
    console.error('Erro ao excluir mensagem no Supabase:', error);
    notify('A mensagem não foi excluída do banco.');
    return false;
  }
  return true;
}

function money(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function notify(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function renderSaved() {
  save();
  render();
}

function slug(value) {
  return String(value || 'minha-loja')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'minha-loja';
}

function shopLink() {
  if (!state.shop || !state.shop.publicId) return location.origin + location.pathname;
  return `${location.origin}${location.pathname}?loja=${encodeURIComponent(state.shop.publicId)}`;
}

function publicShop() {
  return new URLSearchParams(location.search).get('loja');
}

function merchantLogged() {
  return !!currentUser;
}

function clearMerchantState() {
  state.merchant = null;
  state.shop = null;
  state.categories = [];
  state.products = [];
  state.orders = [];
  state.ratings = [];
  state.messages = [];
  state.cart = [];
}

function brand() {
  return '<a class="brand" href="/"><span class="brand-mark">P</span><span class="brand-word"><span class="brand-pede">Pede</span><span class="brand-ia">IA</span></span></a>';
}

function ensureDemoData() {
  if (state.merchant || state.shop) return;
  state.merchant = {
    name: 'João da Silva',
    email: 'joao@exemplo.com',
    password: '123456'
  };
  state.shop = {
    name: 'Brasa & Massa',
    type: 'Hamburgueria',
    publicId: 'brasa-massa-demo',
    description: 'Hamburgueres artesanais, porções e bebidas para quem curte sabor de verdade.',
    photo: '',
    isOpen: true,
    schedule: defaultShopSchedule()
  };
  state.categories = ['Lanches', 'Porções', 'Bebidas'];
  state.products = [
    { id: 1, name: 'X-Bacon', category: 'Lanches', description: 'Pão, burger, bacon, queijo e molho da casa.', price: 32.9, available: true, photo: '' },
    { id: 2, name: 'Batata Chedar', category: 'Porções', description: 'Porção crocante com cheddar e cebola.', price: 24.5, available: true, photo: '' },
    { id: 3, name: 'Refrigerante 600ml', category: 'Bebidas', description: 'Escolha seu sabor favorito.', price: 8.5, available: true, photo: '' }
  ];
  save();
}

function shopIsConfigured(shop = state.shop) {
  if (!shop) return false;
  const name = String(shop.name || '').trim();
  const type = String(shop.type || '').trim();
  const description = String(shop.description || '').trim();
  return Boolean(name && type && description);
}

function merchantSetupView() {
  if (!currentUser || !state.merchant) return authView();

  app.innerHTML = `
    <main class="auth-screen">
      <div class="auth-art">
        ${brand()}
        <div class="art-copy">
          <span class="eyebrow">CONFIGURAR LOJA</span>
          <h1>Falta pouco.<br><em>Vamos personalizar sua loja.</em></h1>
          <p>Preencha os dados essenciais para ativar o painel e liberar o link da sua loja.</p>
          <div class="art-tiles">
            <div class="art-tile burger-tile"></div>
            <div class="art-tile drink-tile"></div>
            <div class="art-tile chart-tile"></div>
          </div>
        </div>
      </div>

      <section class="auth-card">
        <span class="eyebrow">SEU NEGÓCIO</span>
        <h2>Dados da loja</h2>
        <p>Complete as informações para abrir o painel.</p>

        <form id="shop-setup-form" class="auth-form">
          <label>Nome da loja<input name="shopName" value="${esc(state.shop?.name || '')}" required placeholder="Ex.: Brasa & Massa"></label>
          <label>Tipo de comercio<select name="shopType">
            <option ${state.shop?.type === 'Restaurante' ? 'selected' : ''}>Restaurante</option>
            <option ${state.shop?.type === 'Lanchonete' ? 'selected' : ''}>Lanchonete</option>
            <option ${state.shop?.type === 'Hamburgueria' ? 'selected' : ''}>Hamburgueria</option>
            <option ${state.shop?.type === 'Pizzaria' ? 'selected' : ''}>Pizzaria</option>
            <option ${state.shop?.type === 'Loja' ? 'selected' : ''}>Loja</option>
            <option ${state.shop?.type === 'Outro comercio' ? 'selected' : ''}>Outro comercio</option>
          </select></label>
          <label>Descricao<textarea name="description" rows="4" required placeholder="Descreva seu comercio, o que vende e o que torna sua loja especial.">${esc(state.shop?.description || '')}</textarea></label>
          <button class="primary-button auth-submit" type="submit">Salvar e entrar no painel</button>
        </form>
      </section>
    </main>
  `;

  document.querySelector('#shop-setup-form').onsubmit = async (event) => {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const shopName = String(form.get('shopName') || '').trim();
    const shopType = String(form.get('shopType') || 'Loja').trim();
    const description = String(form.get('description') || '').trim();

    if (!shopName || !shopType || !description) {
      notify('Preencha nome, tipo e descrição da loja.');
      return;
    }

    const payload = {
      nome: shopName,
      tipo: shopType,
      descricao: description,
      public_id: state.shop?.publicId || `${slug(shopName)}-${Math.random().toString(36).slice(2, 7)}`,
      esta_aberta: true,
      aceita_entrega: true,
      aceita_retirada: true,
      tempo_entrega: 45,
      tempo_retirada: 20,
      foto_url: state.shop?.photo || null,
      capa_url: state.shop?.cover || null
    };

    try {
      if (!state.shop) {
        const { data: shopData, error: shopError } = await supabaseClient
          .from('lojas')
          .insert({
            merchant_id: currentUser.id,
            ...payload
          })
          .select()
          .single();

        if (shopError) {
          console.error(shopError);
          notify('Erro ao criar a loja.');
          return;
        }

        state.shop = {
          id: shopData.id,
          merchantId: shopData.merchant_id,
          publicId: shopData.public_id,
          name: shopData.nome || shopData.name || '',
          type: shopData.tipo || shopData.type || '',
          description: shopData.descricao ?? shopData.description ?? '',
          photo: shopData.foto_url || shopData.photo_url || '',
          cover: shopData.capa_url || '',
          isOpen: shopData.esta_aberta ?? shopData.is_open ?? true,
          schedule: defaultShopSchedule()
        };
      } else {
        const { error: updateError } = await supabaseClient
          .from('lojas')
          .update({
            nome: shopName,
            tipo: shopType,
            descricao: description,
            public_id: payload.public_id,
            foto_url: payload.foto_url,
            capa_url: payload.capa_url,
            esta_aberta: true,
            aceita_entrega: true,
            aceita_retirada: true,
            tempo_entrega: 45,
            tempo_retirada: 20,
            updated_at: new Date().toISOString()
          })
          .eq('id', state.shop.id);

        if (updateError) {
          console.error(updateError);
          notify('Erro ao salvar os dados da loja.');
          return;
        }

        state.shop = {
          ...state.shop,
          publicId: payload.public_id,
          name: shopName,
          type: shopType,
          description,
          photo: payload.foto_url || '',
          cover: payload.capa_url || '',
          isOpen: true,
          schedule: state.shop.schedule || defaultShopSchedule()
        };
      }

      notify('Loja configurada com sucesso!');
      render();
    } catch (error) {
      console.error('Erro na configuração da loja:', error);
      notify('Erro inesperado ao configurar a loja.');
    }
  };
}

function render() {
  const lojaParam = publicShop();
  if (lojaParam !== null) {
    return lojaParam === state.shop?.publicId ? customerShop() : missingShop();
  }

  if (!merchantLogged() || !state.merchant) return authView();
  if (!state.shop || !shopIsConfigured()) return merchantSetupView();
  if (state.view === 'chat') markMessagesAsRead('merchant');
  merchantPanel();
}

async function bootstrap() {
  try {
    const {
      data: {
        session
      }
    } = await supabaseClient.auth.getSession();

    currentSession = session;
    currentUser = session?.user || null;

    if (currentUser) {
      await loadMerchantFromSupabase();
    }

    render();
    startLiveRefresh();
  } catch (error) {
    console.error('Erro ao iniciar o PedeIA:', error);
    render();
  }
}
async function loadMerchantFromSupabase() {
  if (!currentUser) return;

  const { data: merchant, error: merchantError } =
    await supabaseClient
      .from('comerciantes')
      .select('*')
      .eq('id', currentUser.id)
      .single();

  if (merchantError) {
    console.error('Erro ao carregar comerciante:', merchantError);
    return;
  }

  state.merchant = {
    id: merchant.id,
    name: merchant.nome || merchant.name || currentUser.user_metadata?.name || 'Comerciante',
    email: merchant.email
  };

  const { data: shop, error: shopError } =
    await supabaseClient
      .from('lojas')
      .select('*')
      .eq('merchant_id', currentUser.id)
      .limit(1)
      .maybeSingle();

  if (shopError) {
    console.error('Erro ao carregar loja:', shopError);
    return;
  }

  if (shop) {
    state.shop = {
      id: shop.id,
      merchantId: shop.merchant_id,
      publicId: shop.public_id,
      name: shop.nome || shop.name || '',
      type: shop.tipo || shop.type || '',
      description: shop.descricao ?? shop.description ?? '',
      photo: shop.foto_url || shop.photo_url || '',
      cover: shop.capa_url || '',
      isOpen: shop.esta_aberta ?? shop.is_open ?? true,
      schedule: defaultShopSchedule()
    };
    await loadCatalogFromSupabase();
    await loadOrdersAndMessagesFromSupabase();
  } else {
    state.shop = null;
  }
}

async function loadCatalogFromSupabase() {
  if (!state.shop?.id) return;

  const [{ data: categories, error: categoryError }, { data: products, error: productError }] = await Promise.all([
    supabaseClient.from('categorias').select('id, nome, ordem').eq('loja_id', state.shop.id).order('ordem'),
    supabaseClient.from('produtos').select('*').eq('loja_id', state.shop.id).order('created_at')
  ]);

  if (categoryError) {
    console.error('Erro ao carregar categorias:', categoryError);
    return;
  }
  if (productError) {
    console.error('Erro ao carregar produtos:', productError);
    return;
  }

  state.categories = categories.map((category) => category.nome);
  state.products = products.map((product) => ({
    id: product.id,
    name: product.nome,
    category: categories.find((category) => category.id === product.categoria_id)?.nome || '',
    description: product.descricao || '',
    price: Number(product.preco || 0),
    available: product.disponivel,
    photo: product.foto_url || ''
  }));
}

async function loadOrdersAndMessagesFromSupabase() {
  if (!state.shop?.id) return;

  const [{ data: orders, error: orderError }, { data: messages, error: messageError }] = await Promise.all([
    supabaseClient.from('pedidos').select('*, itens_do_pedido(*)').eq('loja_id', state.shop.id).order('created_at', { ascending: false }),
    supabaseClient.from('mensagens').select('*').order('created_at')
  ]);

  if (orderError) {
    console.error('Erro ao carregar pedidos do Supabase:', orderError);
  } else {
    state.orders = orders.map((order) => ({
      id: order.id,
      supabaseId: order.id,
      customer: order.cliente_nome || 'Cliente',
      phone: order.cliente_telefone || '',
      address: order.endereco || '',
      payment: order.pagamento,
      fulfillment: order.modalidade,
      status: order.status,
      total: Number(order.total || 0),
      notes: order.observacoes || '',
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      readyAt: order.pronto_em ? new Date(order.pronto_em).getTime() : Date.now(),
      items: (order.itens_do_pedido || []).map((item) => ({
        id: item.produto_id,
        name: item.nome_produto,
        description: item.descricao_produto,
        quantity: item.quantidade,
        price: Number(item.preco_unitario || 0),
        notes: item.observacao || ''
      }))
    }));
  }

  if (messageError) {
    console.error('Erro ao carregar mensagens do Supabase:', messageError);
  } else {
    state.messages = messages.map((message) => ({
      id: message.id,
      orderId: message.pedido_id || null,
      from: message.tipo_remetente,
      text: message.mensagem,
      time: new Date(message.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      scope: message.pedido_id ? 'order' : 'store',
      vistaPeloComerciante: message.vista_pelo_comerciante,
      vistaPeloCliente: message.vista_pelo_cliente,
      fixada: Boolean(message.fixada)
    }));
  }
}

function startLiveRefresh() {
  if (window.__pedeiaLiveRefresh) return;

  window.__pedeiaLiveRefresh = setInterval(async () => {
    const lojaParam = publicShop();

    // Área pública da loja
    if (lojaParam !== null) {
      await syncServerState();

      return;
    }

    // IMPORTANTE:
    // Não recriar a tela de login automaticamente.
    // Só atualizar a área do comerciante se ele já estiver logado.
    if (merchantLogged() && app) {
      await syncServerState();
    }
  }, 1500);
}

function authView() {
  app.innerHTML = `
    <main class="auth-screen">
      <div class="auth-art">
        ${brand()}
        <div class="art-copy">
          <span class="eyebrow">PARA QUEM FAZ ACONTECER</span>
          <h1>Seu negocio.<br><em>Do seu jeito.</em></h1>
          <p>Uma central bonita para vender, organizar pedidos e conversar com quem escolheu sua loja.</p>
          <div class="art-tiles">
            <div class="art-tile burger-tile"></div>
            <div class="art-tile drink-tile"></div>
            <div class="art-tile chart-tile"></div>
          </div>
        </div>
      </div>
      <section class="auth-card">
        <span class="eyebrow">PAINEL DO COMERCIANTE</span>
        <h2>Vamos comecar?</h2>
        <p>Crie sua conta e coloque sua loja no ar.</p>
       <div class="auth-tabs">
        <button
          type="button"
          class="${currentAuthTab === 'register' ? 'selected' : ''}"
          data-auth="register"
          aria-selected="${currentAuthTab === 'register' ? 'true' : 'false'}"
        >
          Criar conta
        </button>

        <button
          type="button"
          class="${currentAuthTab === 'login' ? 'selected' : ''}"
          data-auth="login"
          aria-selected="${currentAuthTab === 'login' ? 'true' : 'false'}"
        >
          Entrar
        </button>
      </div>

       <form
          id="register-form"
          class="auth-form ${currentAuthTab === 'register' ? '' : 'hidden'}"
        >
          <label>Seu nome<input name="name" required placeholder="Como podemos chamar voce?"></label>
          <label>E-mail<input name="email" type="email" required placeholder="voce@email.com"></label>
          <label>Senha<input name="password" type="password" minlength="6" required placeholder="Minimo de 6 caracteres"></label>
          <label>Nome do comercio<input name="shopName" required placeholder="Ex.: Brasa & Massa"></label>
          <label>Tipo de comercio<select name="shopType"><option>Restaurante</option><option>Lanchonete</option><option>Hamburgueria</option><option>Pizzaria</option><option>Loja</option><option>Outro comercio</option></select></label>
          <button class="primary-button auth-submit">Criar minha conta <b>-></b></button>
        </form>

        <form
          id="login-form"
          class="auth-form ${currentAuthTab === 'login' ? '' : 'hidden'}"
        >
          <label>E-mail<input name="email" type="email" required placeholder="voce@email.com"></label>
          <label>Senha<input name="password" type="password" required placeholder="Sua senha"></label>
          <button class="primary-button auth-submit">Entrar no painel <b>-></b></button>
          <button class="text-button" type="button" id="resend-confirmation">Reenviar confirmacao de e-mail</button>
        </form>

        <p class="auth-note">O cliente pode pedir sem cadastro. Se criar uma conta, seus dados ficam disponiveis em outros dispositivos quando o banco estiver conectado.</p>
      </section>
    </main>
  `;

  document.querySelectorAll('[data-auth]').forEach((button) => {
    button.onclick = () => switchAuth(button.dataset.auth);
  });
  document.querySelector('#register-form').onsubmit = registerMerchant;
  document.querySelector('#login-form').onsubmit = loginMerchant;
  document.querySelector('#resend-confirmation').onclick = resendConfirmation;
}
function switchAuth(type) {
  const registerForm = document.querySelector('#register-form');
  const loginForm = document.querySelector('#login-form');

  if (!registerForm || !loginForm) return;

  // Guarda a aba atual
  currentAuthTab = type;

  document.querySelectorAll('[data-auth]').forEach((button) => {
    const selected = button.dataset.auth === type;

    button.classList.toggle('selected', selected);
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
  });

  registerForm.classList.toggle('hidden', type !== 'register');
  loginForm.classList.toggle('hidden', type !== 'login');
}
async function registerMerchant(event) {
  event.preventDefault();

  const data = new FormData(event.currentTarget);

  const name = String(data.get('name') || '').trim();
  const email = String(data.get('email') || '').trim().toLowerCase();
  const password = String(data.get('password') || '');
  const shopName = String(data.get('shopName') || '').trim();
  const shopType = String(data.get('shopType') || 'Loja').trim();

  if (!name || !email || !shopName || password.length < 6) {
    notify('Preencha todos os campos corretamente.');
    return;
  }

  try {
    notify('Criando sua conta...');

    const { data: authData, error: authError } =
      await supabaseClient.auth.signUp({
        email,
        password
      });

    if (authError) {
      console.error(authError);
      notify(authError.message || 'Erro ao criar a conta.');
      return;
    }

    const user = authData.user;

    if (!user) {
      notify('Não foi possível criar o usuário.');
      return;
    }

    const { error: merchantError } = await supabaseClient
      .from('comerciantes')
      .insert({
        id: user.id,
        nome: name,
        email: email
      });

    if (merchantError) {
      console.error(merchantError);

      await supabaseClient.auth.signOut();

      notify('Erro ao salvar os dados do comerciante.');
      return;
    }

    const publicId =
      `${slug(shopName)}-${Math.random().toString(36).slice(2, 7)}`;

    const { data: shopData, error: shopError } =
      await supabaseClient
        .from('lojas')
        .insert({
          merchant_id: user.id,
          public_id: publicId,
          nome: shopName,
          tipo: shopType,
          descricao: '',
          foto_url: null,
          capa_url: null,
          esta_aberta: true,
          aceita_entrega: true,
          aceita_retirada: true,
          tempo_entrega: 45,
          tempo_retirada: 20
        })
        .select()
        .single();

    if (shopError) {
      console.error(shopError);

      await supabaseClient
        .from('comerciantes')
        .delete()
        .eq('id', user.id);

      await supabaseClient.auth.signOut();

      notify('Erro ao criar a loja.');
      return;
    }

    currentUser = user;
    currentSession = authData.session;

    state.merchant = {
      id: user.id,
      name: name,
      email: email
    };

    state.shop = {
      id: shopData.id,
      merchantId: shopData.merchant_id,
      publicId: shopData.public_id,
      name: shopData.nome || shopData.name || '',
      type: shopData.tipo || shopData.type || '',
      description: shopData.descricao ?? shopData.description ?? '',
      photo: shopData.foto_url || shopData.photo_url || '',
      cover: shopData.capa_url || '',
      isOpen: shopData.esta_aberta ?? shopData.is_open ?? true,
      schedule: defaultShopSchedule()
    };

    state.categories = [];
    state.products = [];
    state.orders = [];
    state.ratings = [];
    state.messages = [];
    state.cart = [];

    render();

    notify('Conta criada com sucesso!');
  } catch (error) {
    console.error(error);
    notify('Erro inesperado ao criar a conta.');
  }
}
async function loginMerchant(event) {
  event.preventDefault();

  const data = new FormData(event.currentTarget);

  const email = String(data.get('email') || '')
    .trim()
    .toLowerCase();

  const password = String(data.get('password') || '');

  if (!email || !password) {
    notify('Preencha o e-mail e a senha.');
    return;
  }

  try {
    if (typeof supabaseClient === 'undefined') {
      throw new Error(
        'supabaseClient não foi carregado. Verifique o index.html.'
      );
    }

    const { data: authData, error } =
      await supabaseClient.auth.signInWithPassword({
        email,
        password
      });

    if (error) {
      console.error('ERRO DE LOGIN:', error);
      if (error.code === 'email_not_confirmed' || /email not confirmed/i.test(error.message || '')) {
        notify('Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada ou reenvie a confirmação.');
        return;
      }
      notify(error.message || 'E-mail ou senha inválidos.');
      return;
    }

    if (!authData?.user) {
      console.error('Supabase não retornou usuário.');
      notify('Login não retornou um usuário.');
      return;
    }

    currentUser = authData.user;
    currentSession = authData.session;

    await loadMerchantFromSupabase();

    if (!state.merchant || !state.shop) {
      state.merchant = {
        id: authData.user.id,
        name: authData.user.user_metadata?.name || 'Comerciante',
        email: authData.user.email || email
      };
    }

    sessionStorage.setItem(sessionKey, 'active');
    save();

    notify('Login realizado com sucesso!');
    render();
  } catch (error) {
    console.error('ERRO REAL DO LOGIN:', error);
    notify(error?.message || 'Erro inesperado ao entrar.');
  }
}

async function resendConfirmation() {
  const email = String(document.querySelector('#login-form input[name="email"]')?.value || '')
    .trim()
    .toLowerCase();

  if (!email) {
    notify('Digite seu e-mail para reenviar a confirmação.');
    return;
  }

  const { error } = await supabaseClient.auth.resend({
    type: 'signup',
    email
  });

  if (error) {
    console.error('ERRO AO REENVIAR CONFIRMAÇÃO:', error);
    notify('Não foi possível reenviar agora. Confira o e-mail e tente novamente.');
    return;
  }

  notify('E-mail de confirmação reenviado. Verifique sua caixa de entrada e spam.');
}

function nav(view, icon, text, count = '') {
  const badge = Number(count || 0);
  return `<button class="${state.view === view ? 'active' : ''}" data-view="${view}"><span class="nav-icon ${icon}"></span>${text}${badge > 0 ? `<b class="nav-badge">${badge}</b>` : ''}</button>`;
}

function isCompletedOrder(order) {
  return ['Entregue', 'Finalizado', 'Cancelado'].includes(order?.status);
}

function activeOrders() {
  return state.orders.filter((order) => !isCompletedOrder(order));
}

function completedOrders() {
  return state.orders
    .filter(isCompletedOrder)
    .sort((first, second) => Number(second.updatedAt || second.createdAt || 0) - Number(first.updatedAt || first.createdAt || 0));
}

function unreadMessagesCount(type = 'merchant') {
  if (type === 'merchant') {
    return state.messages.filter((msg) => (msg.scope === 'order' || msg.scope === 'store') && msg.from !== 'merchant' && !msg.vistaPeloComerciante).length;
  }
  return state.messages.filter((msg) => msg.scope === 'store' && msg.from === 'merchant' && !msg.vistaPeloCliente).length;
}

function markMessagesAsRead(reader, scope = null) {
  const field = reader === 'merchant' ? 'vistaPeloComerciante' : 'vistaPeloCliente';
  const sender = reader === 'merchant' ? 'merchant' : 'customer';
  let changed = false;

  state.messages.forEach((message) => {
    if ((!scope || message.scope === scope) && message.from !== sender && !message[field]) {
      message[field] = true;
      changed = true;
    }
  });

  if (changed) save();

  if (changed && typeof supabaseClient !== 'undefined') {
    const updates = state.messages
      .filter((message) => message[field] && isUuid(message.id))
      .map((message) => supabaseClient
        .from('mensagens')
        .update({ [field === 'vistaPeloComerciante' ? 'vista_pelo_comerciante' : 'vista_pelo_cliente']: true })
        .eq('id', message.id));
    void Promise.all(updates);
  }
}

function merchantPanel() {
  const page = state.view;
  const revenue = state.orders.filter((order) => order.createdAt && order.createdAt > Date.now() - 86400000).reduce((sum, order) => sum + Number(order.total || 0), 0);
  const printerConnected = state.printers.some((printer) => printer.status === 'Conectada');

  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        ${brand()}
        <div class="shop-mini">
          <div class="shop-avatar">${state.shop.photo ? `<img src="${state.shop.photo}" alt="">` : esc(state.shop.name[0])}</div>
          <div>
            <strong>${esc(state.shop.name)}</strong>
            <small>${state.shop.isOpen ? 'Aberta agora' : 'Fechada'}</small>
          </div>
          <button class="toggle-store ${state.shop.isOpen ? 'on' : 'off'}" data-action="toggle-open"><span></span></button>
        </div>

        <div class="persistent-link">
          <div>
            <span>LINK DA SUA LOJA</span>
            <strong>${esc(shopLink().replace(/^https?:\/\//, ''))}</strong>
          </div>
          <button data-action="copy">Copiar</button>
        </div>

        <nav class="side-nav">
          ${nav('orders', 'orders', 'Pedidos', activeOrders().length)}
          ${nav('history', 'orders', 'Histórico', completedOrders().length)}
          ${nav('dashboard', 'home', 'Visao geral')}
          ${nav('menu', 'menu', 'Cardapio')}
          ${nav('categories', 'categories', 'Categorias')}
          ${nav('chat', 'chat', 'Conversas', unreadMessagesCount('merchant'))}
          ${nav('printers', 'settings', 'Impressoras')}
          ${nav('settings', 'settings', 'Minha loja')}
        </nav>

        <div class="sidebar-bottom">
          <button class="help-link" data-action="copy">Compartilhar loja</button>
          <div class="profile-chip">
            <div class="profile-photo">${esc(String(state.merchant.name || 'CO').slice(0, 2).toUpperCase())}</div>
            <div>
              <strong>${esc(state.merchant.name)}</strong>
              <small>Comerciante</small>
            </div>
            <button class="logout-link" data-action="logout">Sair</button>
          </div>
        </div>
      </aside>

      <main class="main-content">
        <header class="topbar">
          <div class="breadcrumb">PedeIA <span>/</span> ${page}</div>
          <div class="topbar-actions">
            <button class="status-bubble ${state.shop.isOpen ? 'is-positive' : 'is-negative'}" data-action="toggle-open" title="${state.shop.isOpen ? 'Loja aberta' : 'Loja fechada'}">
              <span class="status-bubble-icon store-status-icon">▣</span>
              <span class="status-bubble-label">${state.shop.isOpen ? 'Aberta' : 'Fechada'}</span>
            </button>
            <button class="status-bubble ${printerConnected ? 'is-positive' : 'is-negative'}" data-view="printers" title="${printerConnected ? 'Impressora conectada' : 'Nenhuma impressora conectada'}">
              <span class="status-bubble-icon printer-status-icon">▣</span>
              <span class="status-bubble-label">${printerConnected ? 'Impressora conectada' : 'Sem impressora'}</span>
            </button>
            <button class="outline-button" data-action="open-shop">Ver minha loja</button>
          </div>
        </header>

        ${page === 'orders' ? orderBoard() : page === 'history' ? orderHistory() : page === 'dashboard' ? overview(revenue) : page === 'menu' ? menuView() : page === 'categories' ? categoryView() : page === 'chat' ? chatView() : page === 'printers' ? printersView() : settingsView()}
      </main>
      <button class="quick-chat-fab" data-action="quick-chat" aria-label="Abrir conversas">💬</button>
    </div>
  `;

  bindMerchant();
}

function empty(title, text) {
  return `<div class="empty-panel"><span class="empty-mark"></span><strong>${title}</strong><small>${text}</small></div>`;
}

function overview(revenue) {
  return `
    <section class="page-intro">
      <div>
        <p class="eyebrow">PEDIDOS EM TEMPO REAL</p>
        <h1>O movimento da sua loja.</h1>
        <p class="intro-copy">Acompanhe o que esta chegando e o que precisa da sua atencao.</p>
      </div>
      <button class="primary-button" data-view="orders">Abrir pedidos</button>
    </section>

    <section class="stats-grid">
      <article class="stat-card warm"><span>Pedidos hoje</span><strong>${state.orders.filter((order) => sameDay(order.createdAt)).length}</strong><small>Atualizado pelos pedidos reais</small></article>
      <article class="stat-card"><span>Vendas hoje</span><strong>${money(revenue)}</strong><small>Somente pedidos recebidos hoje</small></article>
      <article class="stat-card"><span>Itens no cardapio</span><strong>${state.products.length}</strong><small>${state.products.filter((item) => item.available).length} disponiveis agora</small></article>
      <article class="stat-card"><span>Avaliacao media</span><strong>${ratingValue()}</strong><small>${state.ratings.length} avaliacoes reais</small></article>
    </section>

    <section class="panel live-preview">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">AGORA</p>
          <h2>O que esta acontecendo</h2>
        </div>
        <button class="text-button" data-view="orders">Ver quadro completo</button>
      </div>
      <div class="live-columns">
        <div><span class="live-title incoming">Chegando</span><strong>${countStatus('Aguardando')}</strong></div>
        <div><span class="live-title producing">Em producao</span><strong>${countStatus('Em preparo')}</strong></div>
        <div><span class="live-title ready">Prontos / entrega</span><strong>${countStatus('Pronto') + countStatus('Saiu para entrega')}</strong></div>
      </div>
    </section>
  `;
}

function sameDay(time) {
  if (!time) return false;
  const date = new Date(time);
  const now = new Date();
  return date.toDateString() === now.toDateString();
}

function ratingValue() {
  if (!state.ratings.length) return '-';
  return (state.ratings.reduce((sum, item) => sum + Number(item.value || 0), 0) / state.ratings.length).toFixed(1);
}

function countStatus(status) {
  return state.orders.filter((order) => order.status === status).length;
}

function orderBoard() {
  const query = String(state.orderQuery || '').toLowerCase();
  const visible = activeOrders().filter((order) => {
    const text = `${order.id} ${order.customer || ''}`.toLowerCase();
    const matchesQuery = !query || text.includes(query);
    const matchesFilter = !state.orderFilter || order.fulfillment === state.orderFilter;
    return matchesQuery && matchesFilter;
  });

  return `
    <section class="page-intro board-intro">
      <div>
        <p class="eyebrow">PEDIDOS EM TEMPO REAL</p>
        <h1>Central de pedidos</h1>
        <p class="intro-copy">Aceite, produza e finalize cada pedido sem perder o ritmo.</p>
      </div>
      <button class="primary-button" data-action="copy">Compartilhar loja</button>
    </section>

    <div class="board-alert" role="status">
      <span class="board-alert-icon">!</span>
      <span>Pedidos novos aparecem aqui em tempo real enquanto sua loja estiver aberta.</span>
    </div>

    <div class="board-tools">
      <div class="search-field">
        <span>Buscar</span>
        <input data-order-search value="${esc(state.orderQuery || '')}" placeholder="Cliente ou numero do pedido">
      </div>
      <div class="filter-pills">
        <button class="${!state.orderFilter ? 'selected' : ''}" data-filter="">Todos</button>
        <button class="${state.orderFilter === 'delivery' ? 'selected' : ''}" data-filter="delivery">Delivery</button>
        <button class="${state.orderFilter === 'pickup' ? 'selected' : ''}" data-filter="pickup">Retirada</button>
      </div>
    </div>

    <section class="order-config-panel panel">
      <div class="order-config-header">
        <div class="order-config-pill">
          <span>Balcão</span>
          <strong>${Number(state.delivery.pickupMinutes || 20)} a ${Number(state.delivery.pickupMinutes || 20) + 5} min</strong>
        </div>
        <div class="order-config-pill">
          <span>Delivery</span>
          <strong>${Number(state.delivery.deliveryMinutes || 45)} a ${Number(state.delivery.deliveryMinutes || 45) + 15} min</strong>
        </div>
      </div>
      <div class="order-config-actions">
        <label class="toggle-pill">
          <span>Aceitar os pedidos automaticamente</span>
          <input type="checkbox" data-auto-accept ${state.delivery.autoAccept ? 'checked' : ''}>
        </label>
        <button class="secondary-button" data-action="edit-order-automation">Editar</button>
      </div>
    </section>

    <section class="order-board">
      <div class="board-column incoming-column">
        <header><strong>Chegando</strong><b>${visible.filter((order) => order.status === 'Aguardando').length}</b></header>
        <div class="board-list">
          ${visible.filter((order) => order.status === 'Aguardando').map(orderCard).join('') || empty('Nada aguardando', 'Novos pedidos aparecem aqui.')}
        </div>
      </div>

      <div class="board-column producing-column">
        <header><strong>Em producao</strong><b>${visible.filter((order) => ['Em preparo', 'Pronto'].includes(order.status)).length}</b></header>
        <div class="board-list">
          ${visible.filter((order) => ['Em preparo', 'Pronto'].includes(order.status)).map(orderCard).join('') || empty('Cozinha tranquila', 'Aceite um pedido para comecar.')}
        </div>
      </div>

      <div class="board-column delivery-column">
        <header><strong>Finalizados</strong><b>${visible.filter((order) => ['Saiu para entrega', 'Entregue'].includes(order.status)).length}</b></header>
        <div class="board-list">
          ${visible.filter((order) => ['Saiu para entrega', 'Entregue'].includes(order.status)).map(orderCard).join('') || empty('Sem entregas no momento', 'Aqui ficam envios realizados.')}
        </div>
      </div>
    </section>
  `;
}

function orderHistory() {
  const orders = completedOrders();

  return `
    <section class="page-intro board-intro">
      <div>
        <p class="eyebrow">MEMÓRIA DA SUA OPERAÇÃO</p>
        <h1>Histórico de pedidos</h1>
        <p class="intro-copy">Pedidos concluídos ficam guardados aqui para consulta, sem voltar ao quadro ativo.</p>
      </div>
      <span class="history-total">${orders.length} ${orders.length === 1 ? 'pedido salvo' : 'pedidos salvos'}</span>
    </section>

    <section class="history-panel panel">
      ${orders.length ? `
        <div class="history-list">
          ${orders.map((order) => `
            <article class="history-order">
              <div class="history-order-mark">✓</div>
              <div class="history-order-main">
                <div class="history-order-heading">
                  <strong>${esc(order.id)}</strong>
                  <span>${esc(order.status)}</span>
                </div>
                <p>${esc(order.customer || 'Cliente')} · ${order.fulfillment === 'delivery' ? 'Delivery' : 'Retirada'} · ${money(order.total)}</p>
              </div>
              <time>${formatOrderDate(order.updatedAt || order.createdAt)}</time>
              <button class="outline-button history-details" data-action="open-order" data-id="${order.id}">Ver detalhes</button>
            </article>
          `).join('')}
        </div>
      ` : empty('Nenhum pedido finalizado', 'Quando um pedido for entregue ou cancelado, ele aparecerá aqui.')}
    </section>
  `;
}

function formatOrderDate(value) {
  if (!value) return 'Sem data';
  return new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function orderCard(order) {
  const late = order.status !== 'Entregue' && Number(order.readyAt || 0) < Date.now();
  return `
    <article class="order-card ${late ? 'late' : ''}" data-order-id="${order.id}">
      <div class="order-card-top">
        <strong>${esc(order.id)}</strong>
        <time>${remaining(order)}</time>
      </div>
      <div class="customer-line">
        <span class="customer-avatar">${esc((order.customer || '?').slice(0, 1))}</span>
        <strong>${esc(order.customer || 'Cliente')}</strong>
        <small>${order.fulfillment === 'delivery' ? 'Entrega' : 'Retirada'}</small>
      </div>
      <div class="order-place">${order.fulfillment === 'delivery' ? esc(order.address || 'Endereco nao informado') : 'Retirada no local'}</div>
      <div class="order-payment">${esc(order.payment || 'Pix')} <b>${money(order.total)}</b></div>
      ${order.notes ? `<div class="order-observation">Observacao: ${esc(order.notes)}</div>` : ''}
      <div class="card-actions">
        <button class="secondary-button" data-action="open-order" data-id="${order.id}">Ver detalhes</button>
        ${order.status === 'Aguardando' ? `<button class="primary-button" data-action="accept-order" data-id="${order.id}">Aceitar agora</button>` : order.status === 'Em preparo' ? `<button class="primary-button" data-action="advance-order" data-id="${order.id}">Avancar pedido</button>` : order.status === 'Pronto' && order.fulfillment === 'delivery' ? `<button class="primary-button" data-action="advance-order" data-id="${order.id}">Saiu para entrega</button>` : order.status !== 'Entregue' ? `<button class="primary-button" data-action="advance-order" data-id="${order.id}">Finalizar pedido</button>` : '<span class="delivered-label">Entregue</span>'}
      </div>
    </article>
  `;
}

function remaining(order) {
  if (!order) return 'Sem prazo';
  if (order.status === 'Entregue') return 'Finalizado';
  const readyAt = Number(order.readyAt || 0);
  const minutes = Math.ceil((readyAt - Date.now()) / 60000);
  return minutes < 0 ? `Atrasado ha ${Math.abs(minutes)} min` : `Faltam ${minutes} min`;
}

function orderDetails(order) {
  const messages = state.messages.filter((msg) => msg.orderId === order.id);
  showDialog(`
    <div class="dialog-head">
      <span class="category-icon">PED</span>
      <h2>Pedido ${esc(order.id)}</h2>
      <p>${esc(order.customer || 'Cliente')} · ${order.fulfillment === 'delivery' ? esc(order.address || 'Endereco nao informado') : 'Retirada no local'}</p>
    </div>
    <div class="detail-items">
      ${(order.items || []).map((item) => `<div class="detail-item"><span class="detail-item-photo">${item.photo ? `<img src="${item.photo}" alt="">` : '<span class="food-placeholder"></span>'}</span><span><strong>${item.quantity}x ${esc(item.name)}</strong><small>${esc(item.description || '')}</small></span></div>`).join('') || '<p>Itens registrados no pedido.</p>'}
    </div>
    <div class="detail-chat">
      <strong>Conversa com este cliente</strong>
      <div class="chat-messages compact">
        ${messages.map((msg) => `<div class="message ${msg.from === 'merchant' ? 'mine' : ''}">${esc(msg.text)}<small>${esc(msg.time)}</small></div>`).join('') || '<small>Nenhuma mensagem neste pedido.</small>'}
      </div>
      <form class="inline-chat" data-order-chat="${order.id}">
        <input name="message" required placeholder="Fale sobre este pedido">
        <button>Enviar</button>
      </form>
    </div>
  `);

  document.querySelector('[data-order-chat]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = event.currentTarget.elements.message;
    const text = String(input.value || '').trim();
    if (!text) return;
    state.messages.push({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      orderId: order.id,
      from: 'merchant',
      text,
      time: nowTime(),
      scope: 'order'
    });
    save();
    void persistMessageToSupabase(state.messages[state.messages.length - 1], order.supabaseId || null);
    closeDialog();
    orderDetails(order);
  });
}

function menuView() {
  return `
    <section class="page-intro">
      <div>
        <p class="eyebrow">PRODUTOS E DISPONIBILIDADE</p>
        <h1>Cardapio</h1>
        <p class="intro-copy">Fotos, descricoes, precos e categoria em um unico formulario.</p>
      </div>
      <button class="primary-button" data-action="new-product">Novo produto</button>
    </section>

    <section class="panel full-panel">
      <div class="menu-toolbar">
        <div class="category-tabs">
          ${state.categories.map((category) => `<button>${esc(category)}</button>`).join('')}
          <button class="add-category" data-view="categories">Criar categoria</button>
        </div>
        <span class="muted">${state.products.length} produtos</span>
      </div>

      ${state.products.length ? state.products.map((product) => `
        <div class="manage-row">
          <span class="manage-emoji">${product.photo ? `<img src="${product.photo}" alt="">` : '<span class="food-placeholder"></span>'}</span>
          <div>
            <strong>${esc(product.name)}</strong>
            <small>${esc(product.category)} · ${esc(product.description)}</small>
          </div>
          <b>${money(product.price)}</b>
          <label class="switch">
            <input type="checkbox" data-product="${product.id}" ${product.available ? 'checked' : ''}>
            <span></span>
          </label>
          <button class="dots" data-action="edit-product" data-id="${product.id}">Editar</button>
        </div>
      `).join('') : empty('Seu cardapio esta vazio', 'Crie uma categoria e adicione seu primeiro produto.')}
    </section>
  `;
}

function categoryView() {
  return `
    <section class="page-intro">
      <div>
        <p class="eyebrow">ORGANIZE SEU CARDAPIO</p>
        <h1>Categorias</h1>
        <p class="intro-copy">Crie abas para refris, sucos, hamburgueres, tapiocas e mais.</p>
      </div>
      <button class="primary-button" data-action="new-category">Nova categoria</button>
    </section>

    <section class="category-layout">
      <article class="panel category-create">
        <div class="category-icon">+</div>
        <h2>Uma categoria para cada desejo</h2>
        <p>Ajude o cliente a encontrar o que quer.</p>
        <button class="primary-button" data-action="new-category">Criar categoria</button>
      </article>

      <article class="panel">
        ${state.categories.length ? state.categories.map((category, index) => `
          <div class="category-row">
            <span>${String(index + 1).padStart(2, '0')}</span>
            <strong>${esc(category)}</strong>
            <small>${state.products.filter((item) => item.category === category).length} produtos</small>
            <button class="category-edit-button" data-action="edit-category" data-category="${esc(category)}">Editar</button>
            <button data-action="remove-category" data-category="${esc(category)}">Remover</button>
          </div>
        `).join('') : empty('Nenhuma categoria criada', 'Comece criando a primeira aba.')}
      </article>
    </section>
  `;
}

function conversationKey(message) {
  return message.orderId ? `order:${message.orderId}` : 'store';
}

function conversationTitle(key, messages) {
  if (key === 'store') return 'Conversa geral da loja';
  const order = state.orders.find((item) => String(item.id) === String(key.replace('order:', '')));
  return order ? `${order.customer || 'Cliente'} · Pedido ${order.id}` : `Pedido ${key.replace('order:', '')}`;
}

function chatConversations() {
  const groups = new Map();
  state.messages
    .filter((message) => message.scope === 'order' || message.scope === 'store')
    .forEach((message) => {
      const key = conversationKey(message);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(message);
    });

  return [...groups.entries()]
    .map(([key, messages]) => ({
      key,
      messages,
      pinned: messages.some((message) => message.fixada),
      unread: messages.some((message) => message.from !== 'merchant' && !message.vistaPeloComerciante),
      latest: messages[messages.length - 1]
    }))
    .sort((first, second) => Number(second.pinned) - Number(first.pinned));
}

function chatView() {
  markMessagesAsRead('merchant');
  const conversations = chatConversations();
  const selectedKey = conversations.some((conversation) => conversation.key === state.chatConversation) ? state.chatConversation : null;
  const selected = conversations.find((conversation) => conversation.key === selectedKey);

  return `
    <section class="page-intro">
      <div>
        <p class="eyebrow">CONVERSE COM QUEM PEDIU</p>
        <h1>Conversas</h1>
        <p class="intro-copy">Escolha uma conversa para ver as mensagens e responder ao cliente.</p>
      </div>
    </section>

    <section class="chat-layout">
      <aside class="conversation-list panel">
        <div class="conversation-list-heading"><strong>Suas conversas</strong><span>${conversations.length}</span></div>
        ${conversations.length ? conversations.map((conversation) => `
          <div class="conversation-row ${conversation.key === selectedKey ? 'selected' : ''} ${conversation.pinned ? 'pinned' : ''}">
            <button class="conversation-select" data-chat-conversation="${esc(conversation.key)}">
              <span class="conversation-avatar">${conversation.key === 'store' ? 'L' : 'P'}</span>
              <span class="conversation-summary"><strong>${esc(conversationTitle(conversation.key, conversation.messages))}</strong><small>${esc(conversation.latest?.text || '')}</small></span>
              ${conversation.unread ? '<b class="conversation-unread"></b>' : ''}
            </button>
            <button class="conversation-pin" data-chat-pin-conversation="${esc(conversation.key)}" aria-label="${conversation.pinned ? 'Desafixar conversa' : 'Fixar conversa'}">${conversation.pinned ? '★' : '☆'}</button>
          </div>
        `).join('') : empty('Nenhuma conversa ainda', 'As mensagens dos clientes aparecerão aqui.')}
      </aside>

      <section class="chat-thread panel ${selected ? 'has-conversation' : ''}">
        ${selected ? `
          <header class="chat-thread-heading">
            <div><span class="eyebrow">CONVERSA</span><h2>${esc(conversationTitle(selected.key, selected.messages))}</h2></div>
            <div class="chat-thread-actions">
              <button class="conversation-pin thread-pin" data-chat-pin-conversation="${esc(selected.key)}" aria-label="${selected.pinned ? 'Desafixar conversa' : 'Fixar conversa'}">${selected.pinned ? '★ Fixada' : '☆ Fixar'}</button>
              <button class="close-conversation" data-close-chat aria-label="Fechar conversa" title="Fechar conversa">×</button>
            </div>
          </header>
          <div class="chat-messages">
            ${selected.messages.map((message) => `
              <article class="message ${message.from === 'merchant' ? 'mine' : ''} ${message.fixada ? 'pinned-message' : ''}">
                <div class="message-text">${esc(message.text)}</div>
                <small>${esc(message.time)}</small>
                <div class="message-actions">
                  <button data-chat-pin-message="${esc(message.id)}">${message.fixada ? 'Desafixar' : 'Fixar'}</button>
                  <button data-chat-delete-message="${esc(message.id)}">Excluir</button>
                </div>
              </article>
            `).join('')}
          </div>
          <form class="chat-compose" data-store-chat data-chat-order="${selected.key.startsWith('order:') ? esc(selected.key.replace('order:', '')) : ''}">
            <input name="message" required placeholder="Responder ao cliente">
            <button class="primary-button">Enviar mensagem</button>
          </form>
        ` : empty('Selecione uma conversa', 'Clique em uma conversa ao lado para visualizar as mensagens.')}
      </section>
    </section>
  `;
}

function printersView() {
  const printerTab = state.printerConfig.tab || 'list';
  const activePrinter = state.printers.find((printer) => printer.default) || state.printers[0];

  const modelView = `
    <section class="printer-model-panel panel">
      <div class="printer-section-heading">
        <div>
          <span class="eyebrow">MODELOS DE IMPRESSAO</span>
          <h2>Configure sua comanda</h2>
          <p>Escolha quais informações aparecem na impressão dos pedidos.</p>
        </div>
        <button class="secondary-button" data-printer-tab="list">Voltar para impressoras</button>
      </div>
      <div class="printer-settings-grid">
        <label>Tipo de conexão<select data-printer-field="mode">
          <option value="bluetooth" ${state.printerConfig.mode === 'bluetooth' ? 'selected' : ''}>Bluetooth</option>
          <option value="cabo" ${state.printerConfig.mode === 'cabo' ? 'selected' : ''}>Cabo / USB</option>
          <option value="rede" ${state.printerConfig.mode === 'rede' ? 'selected' : ''}>Rede / IP</option>
          <option value="pdf" ${state.printerConfig.mode === 'pdf' ? 'selected' : ''}>PDF / impressão simples</option>
        </select></label>
        <label>Nome da impressora<input data-printer-field="deviceName" value="${esc(state.printerConfig.deviceName || '')}" placeholder="Ex.: Epson TM-T20"></label>
        <label>Quantidade de vias<input type="number" min="1" max="10" data-printer-field="copies" value="${state.printerConfig.copies || 1}"></label>
      </div>
      <div class="printer-options-grid">
        ${[['autoPrint', 'Imprimir automaticamente ao aceitar'], ['includeCustomer', 'Incluir nome do cliente'], ['includePhone', 'Incluir telefone'], ['includeAddress', 'Incluir dados de entrega'], ['includeItems', 'Incluir itens do pedido'], ['includeNotes', 'Incluir observacoes'], ['includePayment', 'Incluir forma de pagamento'], ['includeFooter', 'Mostrar mensagem final']].map(([field, label]) => `<label class="printer-option"><input type="checkbox" data-printer-field="${field}" ${state.printerConfig[field] ? 'checked' : ''}><span>${label}</span></label>`).join('')}
      </div>
      <label class="printer-footer-field">Mensagem final<textarea data-printer-field="footerText" rows="2">${esc(state.printerConfig.footerText || '')}</textarea></label>
      <button class="primary-button" data-action="save-printer-config">Salvar modelo</button>
    </section>
  `;

  const listView = `
    <section class="printer-list-panel panel">
      <div class="printer-section-heading">
        <div>
          <span class="eyebrow">1. LISTA DE IMPRESSORAS</span>
          <h2>Impressoras conectadas</h2>
        </div>
        <button class="outline-button" data-action="new-printer">+ Adicionar impressora</button>
      </div>
      ${activePrinter ? `
        <article class="printer-card">
          <div class="printer-card-icon">▣</div>
          <div class="printer-card-info">
            <span class="printer-status">✓ ${esc(activePrinter.status || 'Conectada')}</span>
            <strong>${esc(activePrinter.name)}</strong>
            <small>${esc(activePrinter.type || 'Cabo')} · ${Number(state.printerConfig.copies || 1)} via(s)</small>
            <p>Comandas vinculadas à impressão de pedidos, pagamentos e informações da loja.</p>
          </div>
          <div class="printer-card-actions">
            <button class="secondary-button" data-action="print-test">▣ Testar</button>
            <button class="icon-button printer-delete-button" data-action="delete-printer" data-printer-id="${esc(activePrinter.id)}" aria-label="Excluir impressora" title="Excluir impressora">⋮</button>
          </div>
        </article>
      ` : '<div class="printer-empty">Nenhuma impressora cadastrada.</div>'}
      <div class="printer-model-cta">
        <div class="printer-model-icon">⌁</div>
        <div><strong>Criar modelo de comanda</strong><p>Automatize as comandas por tipo de pedido e ganhe eficiência no seu negócio.</p></div>
        <button class="primary-button" data-printer-tab="models">+ Criar modelo</button>
      </div>
    </section>
  `;

  return `
    <section class="page-intro">
      <div>
        <p class="eyebrow">CONFIGURACOES / IMPRESSORAS</p>
        <h1>Impressora</h1>
        <p class="intro-copy">Gerencie os dispositivos e os modelos das suas comandas.</p>
      </div>
    </section>
    <div class="printer-tabs">
      <button class="${printerTab === 'list' ? 'active' : ''}" data-printer-tab="list">1. Lista de impressoras</button>
      <button class="${printerTab === 'models' ? 'active' : ''}" data-printer-tab="models">2. Modelos de impressão</button>
    </div>
    ${printerTab === 'models' ? modelView : listView}
  `;
}

function settingsView() {
  const activeSettingsTab = state.shopSettingsTab || 'identity';
  const schedule = state.shop.schedule || defaultShopSchedule();
  const scheduleRows = weekDays.map((day) => {
    const config = schedule[day] || { enabled: true, open: '11:00', close: '22:00' };
    return `
      <div class="hours-row">
        <label class="hours-day"><input type="checkbox" data-hours-day="${day}" ${config.enabled ? 'checked' : ''}><span>${day}</span></label>
        <div class="hours-range">
          <input type="time" data-hours-open="${day}" value="${config.open}">
          <span>até</span>
          <input type="time" data-hours-close="${day}" value="${config.close}">
        </div>
      </div>
    `;
  }).join('');

  return `
    <section class="page-intro">
      <div>
        <p class="eyebrow">CONFIGURACOES / MINHA LOJA</p>
        <h1>Minha loja</h1>
        <p class="intro-copy">Personalize sua vitrine e configure como os pedidos chegam até você.</p>
      </div>
    </section>

    <div class="shop-settings-tabs">
      <button class="${activeSettingsTab === 'identity' ? 'active' : ''}" data-shop-settings-tab="identity">1. Identidade da loja</button>
      <button class="${activeSettingsTab === 'operation' ? 'active' : ''}" data-shop-settings-tab="operation">2. Operação</button>
      <button class="${activeSettingsTab === 'hours' ? 'active' : ''}" data-shop-settings-tab="hours">3. Horários</button>
    </div>

    <section class="shop-settings-layout">
      <article class="shop-profile-panel panel shop-tab-content ${activeSettingsTab === 'identity' ? 'active' : 'hidden'}">
        <div class="shop-profile-heading">
          <div>
            <span class="eyebrow">1. IDENTIDADE DA LOJA</span>
            <h2>Como seus clientes encontram você</h2>
            <p>Defina a imagem, o nome e a descrição que aparecem na vitrine.</p>
          </div>
          <span class="shop-live-status">${state.shop.isOpen ? 'Aberta' : 'Fechada'}</span>
        </div>
        <div class="shop-cover-preview" style="${state.shop.cover ? `background-image: linear-gradient(90deg, rgba(0,0,0,.64), rgba(0,0,0,.08)), url('${state.shop.cover}')` : ''}">
          <div class="shop-cover-logo">${state.shop.photo ? `<img src="${state.shop.photo}" alt="">` : esc(state.shop.name.slice(0, 1).toUpperCase())}</div>
          <div><strong>${esc(state.shop.name)}</strong><small>Prévia da sua vitrine</small></div>
        </div>
        <div class="shop-form-grid">
          <label>Foto/logo da loja<input type="file" accept="image/*" data-shop-photo></label>
          <label>Imagem de capa da vitrine<input type="file" accept="image/*" data-shop-cover></label>
          <label>Nome da loja<input data-setting="name" value="${esc(state.shop.name)}"></label>
          <label class="shop-description-field">Descrição<textarea data-setting="description">${esc(state.shop.description)}</textarea></label>
        </div>
        <button class="primary-button" data-action="save-shop">Salvar identidade</button>
      </article>

      <article class="shop-link-panel panel shop-tab-content ${activeSettingsTab === 'identity' ? 'active' : 'hidden'}">
        <span class="eyebrow">LINK PUBLICO</span>
        <h2>Compartilhe sua vitrine</h2>
        <p>Envie este endereço para seus clientes fazerem pedidos.</p>
        <div class="shop-link-box"><strong>${esc(shopLink())}</strong><button class="secondary-button" data-action="copy">Copiar link</button></div>
        <button class="outline-button shop-preview-button" data-action="open-shop">Abrir minha vitrine</button>
      </article>

      <article class="operation-settings shop-operation-panel panel shop-tab-content ${activeSettingsTab === 'operation' ? 'active' : 'hidden'}">
        <div class="shop-profile-heading"><div><span class="eyebrow">2. OPERACAO</span><h2>Formas de recebimento</h2><p>Escolha como sua loja atende cada pedido.</p></div></div>
        <div class="shop-options-grid">
          <label class="shop-option"><input type="checkbox" data-delivery="delivery" ${state.delivery.delivery ? 'checked' : ''}><span><strong>Delivery</strong><small>Cliente recebe no endereço</small></span></label>
          <label class="shop-option"><input type="checkbox" data-delivery="pickup" ${state.delivery.pickup ? 'checked' : ''}><span><strong>Retirada no local</strong><small>Cliente busca na loja</small></span></label>
        </div>
        <div class="shop-time-grid"><label>Tempo de delivery<input type="number" min="1" data-delivery-min="deliveryMinutes" value="${state.delivery.deliveryMinutes}"><small>minutos</small></label><label>Tempo de retirada<input type="number" min="1" data-delivery-min="pickupMinutes" value="${state.delivery.pickupMinutes}"><small>minutos</small></label></div>
        <button class="primary-button" data-action="save-delivery">Salvar operação</button>
      </article>

      <article class="schedule-settings shop-schedule-panel panel shop-tab-content ${activeSettingsTab === 'hours' ? 'active' : 'hidden'}">
        <div class="shop-profile-heading"><div><span class="eyebrow">3. HORARIOS</span><h2>Funcionamento semanal</h2><p>Informe quando sua loja estará disponível.</p></div></div>
        <div class="schedule-list">${scheduleRows}</div>
        <button class="primary-button" data-action="save-shop-hours">Salvar horários</button>
      </article>
    </section>
  `;
}

function customerShop() {
  if (!state.shop) return missingShop();
  const total = state.cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
  const cached = JSON.parse(localStorage.getItem(clientKey) || 'null') || {};
  const tracked = state.orders
    .slice()
    .reverse()
    .find((order) => cached.name && order.customer === cached.name);

  const customerChatBadge = unreadMessagesCount('customer') > 0 ? `<span class="chat-badge">${unreadMessagesCount('customer')}</span>` : '';
  const featuredProducts = state.products.filter((product) => product.available).slice(0, 3);
  const repeatProducts = state.products.filter((product) => product.available).slice(0, 2);
  app.innerHTML = `
    <div class="customer-app">
      <header class="customer-header">
        <div class="customer-brand-mark">${state.shop.photo ? `<img src="${state.shop.photo}" alt="">` : esc(state.shop.name.slice(0, 1).toUpperCase())}</div>
        <strong class="customer-store-name">${esc(state.shop.name)}</strong>
        <div class="customer-header-actions">
          <button class="customer-header-icon" data-action="customer-chat" aria-label="Falar com a loja">${customerChatBadge}◌</button>
          <button class="customer-header-icon" data-action="open-cart" aria-label="Abrir sacola">🛒</button>
        </div>
      </header>

      <section class="store-hero" style="${state.shop.cover ? `background-image: linear-gradient(90deg, rgba(0,0,0,.7), rgba(0,0,0,.12)), url('${state.shop.cover}')` : ''}">
        <div class="store-hero-content">
          <span class="open-pill">${state.shop.isOpen ? 'Aberta agora' : 'Fechada'}</span>
          <h1>${esc(state.shop.name)}</h1>
          <p>${esc(state.shop.description)}</p>
          <small>${esc(state.shop.type)}</small>
        </div>
      </section>

      <nav class="customer-tabs">
        <button class="${state.customerView === 'menu' ? 'active' : ''}" data-customer-view="menu">Cardapio</button>
        <button class="${state.customerView === 'tracking' ? 'active' : ''}" data-customer-view="tracking">Acompanhar pedido</button>
      </nav>

      ${tracked && state.customerView === 'tracking' ? customerTrackingPanel(tracked) : ''}

      ${state.customerView === 'menu' ? `
        ${tracked ? customerTracker(tracked) : ''}
        <section class="delivery-banner">
          <div class="delivery-banner-icon">⌁</div>
          <div><strong>${state.delivery.delivery ? 'Entrega disponível' : 'Peça para retirar'}</strong><small>${state.delivery.delivery ? `Receba em aproximadamente ${Number(state.delivery.deliveryMinutes || 45)} minutos` : 'Retirada no local disponível'}</small></div>
          <span>›</span>
        </section>
        <nav class="customer-categories">
          ${state.categories.map((category) => `<a href="#${encodeURIComponent(category)}">${esc(category)}</a>`).join('')}
        </nav>

        <main class="customer-menu">
          ${repeatProducts.length ? `<section class="customer-section repeat-section"><div class="category-heading"><h2>Peça de novo</h2><span>Favoritos da loja</span></div><div class="customer-products repeat-products">${repeatProducts.map(customerProduct).join('')}</div></section>` : ''}
          ${featuredProducts.length ? `<section class="featured-section"><div class="category-heading"><h2>Destaques</h2><span>Mais pedidos</span></div><div class="customer-products featured-products">${featuredProducts.map(customerProduct).join('')}</div></section>` : ''}
          ${state.categories.length ? state.categories.map((category) => `
            <section id="${encodeURIComponent(category)}">
              <div class="category-heading">
                <h2>${esc(category)}</h2>
                <span>${state.products.filter((item) => item.category === category && item.available).length} opcoes</span>
              </div>
              <div class="customer-products">
                ${state.products.filter((item) => item.category === category && item.available).map(customerProduct).join('')}
              </div>
            </section>
          `).join('') : '<div class="customer-empty"><strong>O cardapio esta sendo preparado.</strong><small>Volte em breve.</small></div>'}
        </main>
      ` : ''}

      <button class="floating-cart ${state.cart.length ? '' : 'empty-floating'}" data-action="open-cart">
        Carrinho ${state.cart.length ? `· ${state.cart.length} item(s) · ${money(total)}` : ''}
      </button>
      <nav class="customer-bottom-nav">
        <button class="active" data-customer-view="menu">⌂<small>Inicio</small></button>
        <button data-customer-view="tracking">▣<small>Pedidos</small></button>
        <button data-action="open-cart">🛒<small>Sacola</small></button>
        <button data-action="customer-chat">◌<small>Ajuda</small></button>
      </nav>
    </div>
  `;

  document.querySelectorAll('[data-action]').forEach((button) => {
    button.onclick = handleAction;
  });

  document.querySelectorAll('[data-customer-view]').forEach((button) => {
    button.onclick = () => {
      state.customerView = button.dataset.customerView;
      save();
      customerShop();
    };
  });
}

function customerTrackingPanel(order) {
  const delivered = order.status === 'Entregue';
  const orderItems = (order.items || []).map((item) => `
    <div class="tracking-item">
      <div>
        <strong>${item.quantity}x ${esc(item.name)}</strong>
        <small>${esc(item.description || '')}</small>
      </div>
      <span>${money((Number(item.price || 0) * Number(item.quantity || 0)))}</span>
    </div>
  `).join('');

  return `
    <section class="customer-tracking-page">
      <article class="tracking-main-card">
        <div class="tracking-header">
          <div>
            <p class="eyebrow">PEDIDO ${esc(order.id)}</p>
            <h2>${statusLabel(order.status)}</h2>
          </div>
          <span class="tracking-pill ${order.status === 'Aguardando' ? 'waiting' : order.status === 'Em preparo' ? 'preparing' : order.status === 'Pronto' || order.status === 'Saiu para entrega' ? 'ready' : 'done'}">${esc(order.status)}</span>
        </div>

        <div class="tracker-steps">
          <span class="${order.status !== 'Aguardando' ? 'done' : 'current'}">Recebido</span>
          <span class="${['Em preparo', 'Pronto', 'Saiu para entrega', 'Entregue'].includes(order.status) ? 'done' : order.status === 'Aguardando' ? '' : 'current'}">Preparando</span>
          <span class="${['Pronto', 'Saiu para entrega', 'Entregue'].includes(order.status) ? 'done' : ''}">${order.fulfillment === 'delivery' ? 'A caminho' : 'Pronto'}</span>
          <span class="${delivered ? 'done' : ''}">Finalizado</span>
        </div>

        <div class="tracking-meta">
          <div><span>Tempo</span><strong>${remaining(order)}</strong></div>
          <div><span>Forma</span><strong>${order.fulfillment === 'delivery' ? 'Entrega' : 'Retirada'}</strong></div>
          <div><span>Total</span><strong>${money(order.total || 0)}</strong></div>
        </div>
      </article>

      <div class="tracking-grid">
        <article class="tracking-panel">
          <p class="eyebrow">RESUMO</p>
          <div class="tracking-address-block">
            <strong>${esc(order.customer || 'Cliente')}</strong>
            <small>${esc(order.phone || '')}</small>
            ${order.fulfillment === 'delivery' ? `<small>${esc(order.address || 'Endereço não informado')}</small>` : '<small>Retirada no local</small>'}
          </div>
          <div class="tracking-items">${orderItems || '<p>Itens do pedido aparecerão aqui.</p>'}</div>
        </article>

        <article class="tracking-panel">
          <p class="eyebrow">ATUALIZACOES</p>
          <div class="tracking-updates">
            <div class="update-item"><strong>Pedido recebido</strong><small>Estamos processando seu pedido.</small></div>
            <div class="update-item"><strong>Em preparo</strong><small>A cozinha esta montando sua comanda.</small></div>
            <div class="update-item"><strong>Pronto</strong><small>Seu pedido esta pronto para retirada ou entrega.</small></div>
          </div>
          <div class="tracking-actions">
            <button class="primary-button" data-action="customer-chat">Falar com a loja</button>
            ${delivered && !order.confirmed ? `<button class="primary-button" data-action="confirm-receipt" data-id="${order.id}">Confirmar recebi</button>` : ''}
            ${delivered ? `<button class="secondary-button" data-action="rate-order" data-id="${order.id}">Avaliar pedido</button>` : ''}
          </div>
        </article>
      </div>
    </section>
  `;
}

function customerTracker(order) {
  const delivered = order.status === 'Entregue';
  return `
    <section class="customer-tracker">
      <div>
        <p class="eyebrow">SEU PEDIDO ${esc(order.id)}</p>
        <h2>${statusLabel(order.status)}</h2>
        <p>${remaining(order)} · ${order.fulfillment === 'delivery' ? 'Entrega' : 'Retirada'}</p>
      </div>
      <div class="tracker-steps">
        <span class="${order.status !== 'Aguardando' ? 'done' : 'current'}">Recebido</span>
        <span class="${['Pronto', 'Saiu para entrega', 'Entregue'].includes(order.status) ? 'done' : order.status === 'Em preparo' ? 'current' : ''}">Preparando</span>
        <span class="${['Saiu para entrega', 'Entregue'].includes(order.status) ? 'done' : ''}">${order.fulfillment === 'delivery' ? 'A caminho' : 'Pronto'}</span>
        <span class="${delivered ? 'done' : ''}">Finalizado</span>
      </div>
      ${delivered && !order.confirmed ? `<button class="primary-button" data-action="confirm-receipt" data-id="${order.id}">Confirmar que recebi</button>` : ''}
      ${delivered ? `<button class="secondary-button" data-action="rate-order" data-id="${order.id}">Avaliar pedido</button>` : ''}
    </section>
  `;
}

function statusLabel(status) {
  return {
    Aguardando: 'Pedido recebido',
    'Em preparo': 'A cozinha esta preparando',
    Pronto: 'Pedido pronto',
    'Saiu para entrega': 'Saiu para entrega',
    Entregue: 'Pedido finalizado'
  }[status] || status;
}

function customerProduct(product) {
  return `
    <article class="customer-product">
      <div class="food-image">${product.photo ? `<img src="${product.photo}" alt="">` : '<span class="food-placeholder"></span>'}</div>
      <div class="customer-product-info">
        <h3>${esc(product.name)}</h3>
        <p>${esc(product.description)}</p>
        <strong>${money(product.price)}</strong>
      </div>
      <button class="add-food" data-action="add-cart" data-id="${product.id}">Adicionar</button>
    </article>
  `;
}

function missingShop() {
  app.innerHTML = `
    <main class="missing-shop">
      ${brand()}
      <div>
        <div class="missing-icon">!</div>
        <h1>Loja nao encontrada</h1>
        <p>Confira o link recebido ou peça um novo endereco ao comercio.</p>
        <a class="primary-button" href="/">Voltar</a>
      </div>
    </main>
  `;
}

function bindMerchant() {
  document.querySelectorAll('[data-shop-settings-tab]').forEach((button) => {
    button.onclick = () => {
      state.shopSettingsTab = button.dataset.shopSettingsTab;
      save();
      render();
    };
  });

  document.querySelectorAll('[data-printer-tab]').forEach((button) => {
    button.onclick = () => {
      state.printerConfig.tab = button.dataset.printerTab;
      save();
      render();
    };
  });

  document.querySelectorAll('[data-chat-conversation]').forEach((button) => {
    button.onclick = () => {
      state.chatConversation = button.dataset.chatConversation;
      save();
      render();
    };
  });

  document.querySelectorAll('[data-close-chat]').forEach((button) => {
    button.onclick = () => {
      state.chatConversation = null;
      save();
      render();
    };
  });

  document.querySelectorAll('[data-chat-pin-conversation]').forEach((button) => {
    button.onclick = async () => {
      const key = button.dataset.chatPinConversation;
      const messages = state.messages.filter((message) => conversationKey(message) === key);
      const pinned = !messages.some((message) => message.fixada);
      messages.forEach((message) => { message.fixada = pinned; });
      save();
      render();
      await Promise.all(messages.map((message) => updateMessageInSupabase(message, { fixada: pinned })));
    };
  });

  document.querySelectorAll('[data-chat-pin-message]').forEach((button) => {
    button.onclick = async () => {
      const message = state.messages.find((item) => String(item.id) === String(button.dataset.chatPinMessage));
      if (!message) return;
      const pinned = !message.fixada;
      message.fixada = pinned;
      save();
      render();
      await updateMessageInSupabase(message, { fixada: pinned });
    };
  });

  document.querySelectorAll('[data-chat-delete-message]').forEach((button) => {
    button.onclick = async () => {
      const message = state.messages.find((item) => String(item.id) === String(button.dataset.chatDeleteMessage));
      if (!message || !window.confirm('Excluir esta mensagem permanentemente?')) return;
      const deleted = await deleteMessageFromSupabase(message);
      if (!deleted) return;
      state.messages = state.messages.filter((item) => item !== message);
      save();
      render();
      notify('Mensagem excluída.');
    };
  });

  document.querySelector('[data-store-chat]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = String(new FormData(event.currentTarget).get('message') || '').trim();
    if (!text) return;
    state.messages.push({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      from: 'merchant',
      text,
      time: nowTime(),
      scope: event.currentTarget.dataset.chatOrder ? 'order' : 'store',
      orderId: event.currentTarget.dataset.chatOrder || null
    });
    save();
    void persistMessageToSupabase(state.messages[state.messages.length - 1], event.currentTarget.dataset.chatOrder || null);
    render();
    notify('Mensagem enviada.');
  });

  document.querySelectorAll('[data-view]').forEach((button) => {
    button.onclick = () => {
      state.view = button.dataset.view;
      renderSaved();
    };
  });

  document.querySelectorAll('[data-action]').forEach((button) => {
    button.onclick = handleAction;
  });

  document.querySelectorAll('[data-filter]').forEach((button) => {
    button.onclick = () => {
      state.orderFilter = button.dataset.filter;
      renderSaved();
    };
  });

  document.querySelector('[data-order-search]')?.addEventListener('input', (event) => {
    state.orderQuery = event.target.value;
    renderSaved();
  });

  document.querySelectorAll('[data-product]').forEach((input) => {
    input.onchange = () => {
      const item = state.products.find((product) => String(product.id) === String(input.dataset.product));
      if (item) {
        item.available = input.checked;
        renderSaved();
      }
    };
  });

  document.querySelector('[data-shop-photo]')?.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    readImage(file, (image) => {
      state.shop.photo = image;
      renderSaved();
    });
  });

  document.querySelector('[data-shop-cover]')?.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    readImage(file, async (image) => {
      state.shop.cover = image;
      if (state.shop.id && currentUser) {
        const { error } = await supabaseClient
          .from('lojas')
          .update({ capa_url: image, updated_at: new Date().toISOString() })
          .eq('id', state.shop.id);
        if (error) console.error('Erro ao salvar capa da loja:', error);
      }
      renderSaved();
    });
  });
}

function handleAction(event) {
  const button = event.currentTarget;
  const action = button.dataset.action;

  if (action === 'new-category') return categoryDialog();
  if (action === 'edit-category') return categoryDialog(button.dataset.category);
  if (action === 'new-product' || action === 'edit-product') return productDialog(button.dataset.id);
  if (action === 'remove-category') {
    const categoryName = button.dataset.category;
    state.categories = state.categories.filter((item) => item !== categoryName);
    state.products = state.products.filter((item) => item.category !== categoryName);
    return renderSaved();
  }
  if (action === 'toggle-open') {
    const nextOpen = !state.shop.isOpen;
    if (!nextOpen) {
      const shouldProceed = window.confirm('Deseja fechar a loja? Os pedidos finalizados continuarão no histórico.');
      if (!shouldProceed) return;
    }
    state.shop.isOpen = nextOpen;
    return renderSaved();
  }
  if (action === 'save-shop') {
    document.querySelectorAll('[data-setting]').forEach((input) => {
      state.shop[input.dataset.setting] = input.value.trim();
    });
    return renderSaved();
  }
  if (action === 'save-delivery') {
    document.querySelectorAll('[data-delivery-min]').forEach((input) => {
      state.delivery[input.dataset.deliveryMin] = Number(input.value || 0);
    });
    return renderSaved();
  }
  if (action === 'edit-order-automation') {
    showDialog(`
      <div class="dialog-head">
        <span class="category-icon">Tempo</span>
        <h2>Configurar pedidos</h2>
        <p>Escolha se aceita automaticamente e ajuste os prazos.</p>
      </div>
      <form id="automation-form" class="dialog-form">
        <label class="choice-row">
          <input type="checkbox" name="autoAccept" ${state.delivery.autoAccept ? 'checked' : ''}>
          <span><strong>Aceitar pedidos automaticamente</strong><small>Sem precisar confirmar cada ordem nova</small></span>
        </label>
        <label>Tempo estimado para retirada<input type="number" min="1" name="pickupMinutes" value="${Number(state.delivery.pickupMinutes || 20)}"></label>
        <label>Tempo estimado para delivery<input type="number" min="1" name="deliveryMinutes" value="${Number(state.delivery.deliveryMinutes || 45)}"></label>
        <button class="primary-button" type="submit">Salvar ajustes</button>
      </form>
    `);

    const form = document.querySelector('#automation-form');
    if (!form) return;
    form.onsubmit = (event) => {
      event.preventDefault();
      const data = new FormData(form);
      state.delivery.autoAccept = Boolean(data.get('autoAccept'));
      state.delivery.pickupMinutes = Number(data.get('pickupMinutes') || 20);
      state.delivery.deliveryMinutes = Number(data.get('deliveryMinutes') || 45);
      save();
      closeDialog();
      render();
      notify('Configuração salva.');
    };
    return;
  }
  if (action === 'save-shop-hours') {
    const nextSchedule = { ...defaultShopSchedule(), ...(state.shop.schedule || {}) };
    weekDays.forEach((day) => {
      const enabled = document.querySelector(`[data-hours-day="${day}"]`)?.checked ?? true;
      const open = document.querySelector(`[data-hours-open="${day}"]`)?.value || '11:00';
      const close = document.querySelector(`[data-hours-close="${day}"]`)?.value || '22:00';
      nextSchedule[day] = { enabled, open, close };
    });
    state.shop.schedule = nextSchedule;
    return renderSaved();
  }
  if (action === 'save-printer-config') {
    const form = document.querySelector('[data-printer-field="mode"]');
    if (form) state.printerConfig.mode = form.value;
    document.querySelectorAll('[data-printer-field]').forEach((input) => {
      const field = input.dataset.printerField;
      if (field === 'mode') return;
      if (input.type === 'checkbox') state.printerConfig[field] = input.checked;
      else if (field === 'copies') state.printerConfig[field] = Number(input.value || 1);
      else state.printerConfig[field] = String(input.value || '');
    });
    return renderSaved();
  }
  if (action === 'new-printer') {
    const nextName = `Impressora ${state.printers.length + 1}`;
    state.printers.push({
      id: `printer-${Date.now()}`,
      name: nextName,
      type: 'bluetooth',
      status: 'Disponivel',
      default: false
    });
    return renderSaved();
  }
  if (action === 'delete-printer') {
    const printer = state.printers.find((item) => String(item.id) === String(button.dataset.printerId));
    if (!printer) return;
    const confirmed = window.confirm(`Excluir a impressora "${printer.name}"?`);
    if (!confirmed) return;
    state.printers = state.printers.filter((item) => item !== printer);
    if (state.printerConfig.deviceName === printer.name) {
      const replacement = state.printers.find((item) => item.status === 'Conectada') || state.printers[0];
      state.printerConfig.deviceName = replacement?.name || '';
      state.printerConfig.mode = replacement?.type || 'cabo';
    }
    return renderSaved();
  }
  if (action === 'connect-printer') {
    const target = state.printers.find((printer) => printer.id === button.dataset.printerId);
    if (!target) return;
    if (navigator.bluetooth && target.type === 'bluetooth') {
      navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: ['device_information'] })
        .then((device) => {
          target.name = device.name || target.name;
          target.status = 'Conectada';
          state.printerConfig.deviceName = target.name;
          state.printerConfig.mode = 'bluetooth';
          save();
          renderSaved();
          notify(`Impressora ${target.name} conectada.`);
        })
        .catch(() => {
          target.status = 'Disponivel';
          save();
          renderSaved();
          notify('Conexão não confirmada. Tente novamente.');
        });
      return;
    }
    target.status = 'Conectada';
    state.printerConfig.deviceName = target.name;
    state.printerConfig.mode = target.type === 'rede' ? 'rede' : target.type === 'bluetooth' ? 'bluetooth' : 'cabo';
    save();
    renderSaved();
    notify(`Impressora ${target.name} pronta para uso.`);
    return;
  }
  if (action === 'print-test') {
    const sample = sampleOrder();
    sample.id = `#TEST-${Date.now().toString().slice(-4)}`;
    return printReceipt(sample);
  }
  if (action === 'logout') {
    (async () => {
      try {
        if (supabaseClient?.auth?.signOut) {
          await supabaseClient.auth.signOut();
        }
      } catch (error) {
        console.error('Erro ao sair do Supabase:', error);
      }

      currentUser = null;
      currentSession = null;
      state.merchant = null;
      state.shop = null;
      sessionStorage.removeItem(sessionKey);
      render();
    })();
    return;
  }
  if (action === 'copy') {
    const text = shopLink();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => notify('Link copiado para compartilhar')).catch(() => {
        notify('Link pronto para copiar');
      });
    }
    notify('Link pronto para copiar');
    return;
  }
  if (action === 'open-shop') return window.open(shopLink(), '_blank', 'noopener');
  if (action === 'open-order') return orderDetails(state.orders.find((order) => order.id === button.dataset.id));
  if (action === 'accept-order') return acceptOrder(button.dataset.id);
  if (action === 'quick-chat') {
    state.view = 'chat';
    return renderSaved();
  }
  if (action === 'advance-order') return advanceOrder(button.dataset.id);

  if (action === 'add-cart') {
    const product = state.products.find((item) => String(item.id) === String(button.dataset.id));
    if (!product) return;
    const current = state.cart.find((item) => item.id === product.id);
    if (current) current.quantity += 1;
    else state.cart.push({ ...product, quantity: 1, notes: '' });
    save();
    return customerShop();
  }

  if (action === 'open-cart') return cartDialog();
  if (action === 'customer-chat') return customerChat();
}

function acceptOrder(id) {
  const order = state.orders.find((item) => item.id === id);
  if (!order) return;
  order.status = 'Em preparo';
  order.updatedAt = Date.now();
  order.readyAt = Date.now() + 12 * 60000;
  save();
  void updateOrderInSupabase(order);
  if (state.printerConfig.autoPrint) printReceipt(order);
  render();
  notify(`Pedido ${order.id} aceito automaticamente.`);
}

function advanceOrder(id) {
  const order = state.orders.find((item) => item.id === id);
  if (!order) return;

  const next = {
    Aguardando: 'Em preparo',
    'Em preparo': 'Pronto',
    Pronto: order.fulfillment === 'delivery' ? 'Saiu para entrega' : 'Entregue',
    'Saiu para entrega': 'Entregue'
  };

  order.status = next[order.status] || 'Entregue';
  order.updatedAt = Date.now();
  if (order.status === 'Pronto' || order.status === 'Saiu para entrega' || order.status === 'Entregue') {
    order.readyAt = Date.now() + 12 * 60000;
  }

  save();
  void updateOrderInSupabase(order);
  render();
  notify(`Pedido ${order.id} atualizado`);
}

function sampleOrder() {
  return {
    id: '#1042',
    customer: 'Maria Souza',
    phone: '(11) 99999-0000',
    address: 'Rua da Liberdade, 240 · Centro',
    payment: 'Pix',
    fulfillment: 'delivery',
    items: [
      { quantity: 1, name: 'X-Bacon', description: 'Sem cebola', price: 32.9 },
      { quantity: 2, name: 'Refrigerante 600ml', description: 'Cola-Cola', price: 8.5 }
    ],
    notes: 'Entregar depois das 19h.',
    total: 49.9,
    createdAt: Date.now()
  };
}

function buildReceiptMarkup(order, config = state.printerConfig, preview = false) {
  const customer = config.includeCustomer ? `<div class="receipt-line"><span>Cliente</span><strong>${esc(order.customer || 'Cliente')}</strong></div>` : '';
  const phone = config.includePhone ? `<div class="receipt-line"><span>Telefone</span><strong>${esc(order.phone || '')}</strong></div>` : '';
  const address = config.includeAddress && order.fulfillment === 'delivery' ? `<div class="receipt-line"><span>Entrega</span><strong>${esc(order.address || '')}</strong></div>` : '';
  const payment = config.includePayment ? `<div class="receipt-line"><span>Pagamento</span><strong>${esc(order.payment || 'Pix')}</strong></div>` : '';
  const notes = config.includeNotes && order.notes ? `<div class="receipt-note"><span>Obs.</span><strong>${esc(order.notes)}</strong></div>` : '';
  const items = config.includeItems ? (order.items || []).map((item) => `
    <div class="receipt-item">
      <div><strong>${item.quantity}x ${esc(item.name)}</strong><small>${esc(item.description || '')}</small></div>
      <span>${money(item.price * (item.quantity || 1))}</span>
    </div>
  `).join('') : '';
  const footer = config.includeFooter ? `<div class="receipt-footer">${esc(config.footerText || 'Obrigado pela preferência!')}</div>` : '';

  return `
    <div class="receipt-paper ${preview ? 'preview' : ''}">
      <div class="receipt-brand">${esc(state.shop?.name || 'PedeIA')}</div>
      <div class="receipt-header">COMANDA ${esc(order.id || '#0000')}</div>
      <div class="receipt-meta">${new Date(order.createdAt || Date.now()).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</div>
      ${customer}
      ${phone}
      ${address}
      ${payment}
      <div class="receipt-divider"></div>
      ${items}
      <div class="receipt-divider"></div>
      <div class="receipt-total"><span>Total</span><strong>${money(order.total || 0)}</strong></div>
      ${notes}
      ${footer}
    </div>
  `;
}

function printReceipt(order) {
  const config = { ...state.printerConfig };
  const printWindow = window.open('', '_blank', 'width=420,height=900');
  if (!printWindow) {
    notify('Seu navegador bloqueou a janela de impressão. Permita popup e tente novamente.');
    return;
  }

  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Comanda ${esc(order.id || '')}</title>
        <style>
          body { margin: 0; background: #f5f5f5; font-family: Arial, sans-serif; color: #1a1a1a; }
          .print-shell { width: 100%; display: flex; justify-content: center; padding: 16px; box-sizing: border-box; }
          .receipt-paper { width: 100%; max-width: 360px; background: #fff; padding: 18px 16px; box-sizing: border-box; }
          .receipt-brand { font-weight: 700; font-size: 17px; text-align: center; margin-bottom: 10px; }
          .receipt-header { font-weight: 700; text-align: center; letter-spacing: 1px; margin-bottom: 8px; }
          .receipt-meta, .receipt-line, .receipt-note, .receipt-total, .receipt-item { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; }
          .receipt-line, .receipt-note { margin-bottom: 8px; }
          .receipt-line span, .receipt-note span, .receipt-total span { opacity: .7; }
          .receipt-item { align-items: flex-start; margin: 8px 0; } .receipt-item strong { display:block; font-size: 12px; }
          .receipt-item small { display:block; font-size: 10px; opacity: .7; }
          .receipt-divider { border-top: 1px dashed #999; margin: 10px 0; }
          .receipt-total { font-size: 13px; font-weight: 700; margin-top: 8px; }
          .receipt-footer { margin-top: 12px; text-align:center; font-size: 11px; opacity: .8; }
          @media print { body { background: #fff; } .print-shell { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="print-shell">
          ${buildReceiptMarkup(order, config, false)}
        </div>
      </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();

  setTimeout(() => {
    try {
      printWindow.print();
    } catch {
      notify('A impressão foi disparada, mas seu navegador pode exigir confirmação do popup.');
    }
  }, 150);

  if (config.mode === 'bluetooth' && navigator.bluetooth) {
    notify('Comanda enviada diretamente para impressão Bluetooth.');
  } else {
    notify(`Comanda ${order.id} enviada diretamente para impressão.`);
  }
}

function categoryDialog(existingName = '') {
  const editing = Boolean(existingName);
  showDialog(`
    <div class="dialog-head">
      <span class="category-icon">${editing ? '✎' : '+'}</span>
      <h2>${editing ? 'Editar categoria' : 'Nova categoria'}</h2>
      <p>${editing ? 'Altere o nome sem perder os produtos desta categoria.' : 'Crie uma aba para organizar seus produtos.'}</p>
    </div>
    <form id="category-form" class="dialog-form">
      <label>Nome da categoria<input name="name" required value="${esc(existingName)}" placeholder="Ex.: Tapiocas"></label>
      <button class="primary-button">${editing ? 'Salvar alterações' : 'Criar categoria'}</button>
    </form>
  `);

  document.querySelector('#category-form').onsubmit = async (event) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name') || '').trim();
    if (!name || (name !== existingName && state.categories.includes(name))) {
      notify('Escolha um nome de categoria diferente.');
      return;
    }

    if (editing) {
      const categoryIndex = state.categories.indexOf(existingName);
      if (categoryIndex < 0) return;
      if (state.shop?.id && typeof supabaseClient !== 'undefined') {
        const { error } = await supabaseClient
          .from('categorias')
          .update({ nome: name, updated_at: new Date().toISOString() })
          .eq('loja_id', state.shop.id)
          .eq('nome', existingName);
        if (error) {
          console.error('Erro ao editar categoria no Supabase:', error);
          notify('Não foi possível editar a categoria no banco.');
          return;
        }
      }
      state.categories[categoryIndex] = name;
      state.products.forEach((product) => {
        if (product.category === existingName) product.category = name;
      });
    } else if (name) {
      state.categories.push(name);
    }
    closeDialog();
    renderSaved();
  };
}

function productDialog(id) {
  const product = state.products.find((item) => String(item.id) === String(id));
  showDialog(`
    <div class="dialog-head">
      <span class="category-icon">Produto</span>
      <h2>${product ? 'Editar produto' : 'Novo produto'}</h2>
      <p>Foto, categoria, descricao e preco em um so lugar.</p>
    </div>
    <form id="product-form" class="dialog-form">
      <label class="photo-picker">+<span>Adicionar foto<input name="photo" type="file" accept="image/*"></span></label>
      <label>Nome<input name="name" required value="${esc(product?.name || '')}" placeholder="Ex.: X-Bacon especial"></label>
      <label>Categoria<select name="category" required>${state.categories.map((category) => `<option ${product?.category === category ? 'selected' : ''}>${esc(category)}</option>`).join('')}</select></label>
      <label>Descricao<textarea name="description" required placeholder="Ingredientes, tamanho e diferenciais.">${esc(product?.description || '')}</textarea></label>
      <label>Preco<input name="price" type="number" min="0.01" step="0.01" required value="${product?.price || ''}" placeholder="0,00"></label>
      <div class="dialog-actions">
        ${product ? '<button class="danger-button" type="button" data-dialog-delete-product>Excluir produto</button>' : ''}
        <button class="primary-button">Salvar produto</button>
      </div>
    </form>
  `);

  document.querySelector('[data-dialog-delete-product]')?.addEventListener('click', async () => {
    if (!window.confirm(`Excluir o produto "${product.name}"?`)) return;
    if (product.id && isUuid(product.id) && typeof supabaseClient !== 'undefined') {
      const { error } = await supabaseClient.from('produtos').delete().eq('id', product.id).eq('loja_id', state.shop.id);
      if (error) {
        console.error('Erro ao excluir produto no Supabase:', error);
        notify('Não foi possível excluir o produto do banco.');
        return;
      }
    }
    state.products = state.products.filter((item) => item !== product);
    closeDialog();
    renderSaved();
    notify('Produto excluído.');
  });

  document.querySelector('#product-form').onsubmit = (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    const finish = (photo) => {
      const next = {
        id: product?.id || Date.now(),
        name: String(data.get('name') || '').trim(),
        category: String(data.get('category') || state.categories[0] || 'Geral'),
        description: String(data.get('description') || '').trim(),
        price: Number(data.get('price') || 0),
        photo: photo || product?.photo || null,
        available: product?.available ?? true
      };

      if (product) Object.assign(product, next);
      else state.products.push(next);

      closeDialog();
      renderSaved();
    };

    const file = form.querySelector('[name=photo]').files[0];
    file ? readImage(file, finish) : finish(null);
  };
}

function showDialog(content) {
  const overlay = document.createElement('div');
  overlay.className = 'cart-overlay dialog-overlay';
  overlay.innerHTML = `<div class="cart-modal dialog-modal"><button class="modal-close">Fechar</button>${content}</div>`;
  overlay.querySelector('.modal-close').onclick = closeDialog;
  overlay.onclick = (event) => {
    if (event.target === overlay) closeDialog();
  };
  document.body.appendChild(overlay);
}

function closeDialog() {
  document.querySelector('.dialog-overlay')?.remove();
}

function readImage(file, callback) {
  if (!file) return callback(null);
  const reader = new FileReader();
  reader.onload = () => callback(reader.result);
  reader.readAsDataURL(file);
}

function cartDialog() {
  const total = state.cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);

  showDialog(`
    <div class="dialog-head">
      <span class="category-icon">Carrinho</span>
      <h2>Sua sacola</h2>
      <p>Deixe um recado para a cozinha em cada item.</p>
    </div>
    <div class="cart-items">
      ${state.cart.length ? state.cart.map((item) => `
        <div class="cart-item">
          <span>${item.photo ? `<img src="${item.photo}" alt="">` : ''}</span>
          <div>
            <strong>${esc(item.name)}</strong>
            <small>${money(item.price)} · ${item.quantity}x</small>
            <label class="note-field">
              <span>OBSERVACOES DO ITEM</span>
              <input data-note="${item.id}" value="${esc(item.notes || '')}" placeholder="Ex.: sem cebola, bem passado...">
              <small>Opcional - a loja vera este recado no pedido</small>
            </label>
          </div>
        </div>
      `).join('') : '<p>Sua sacola esta vazia.</p>'}
    </div>
    ${state.cart.length ? `<div class="cart-total"><span>Total</span><strong>${money(total)}</strong></div><button class="primary-button checkout-button">Continuar para entrega</button>` : ''}
  `);

  document.querySelectorAll('[data-note]').forEach((input) => {
    input.oninput = () => {
      const item = state.cart.find((entry) => String(entry.id) === String(input.dataset.note));
      if (item) item.notes = input.value;
      save();
    };
  });

  document.querySelector('.checkout-button')?.addEventListener('click', () => {
    closeDialog();
    checkoutDialog();
  });
}

function checkoutDialog() {
  const cached = JSON.parse(localStorage.getItem(clientKey) || 'null') || {};
  const modes = [
    state.delivery.delivery ? '<option value="delivery">Entrega</option>' : '',
    state.delivery.pickup ? '<option value="pickup">Retirada no local</option>' : ''
  ].join('');

  showDialog(`
    <div class="dialog-head">
      <span class="category-icon">Pedido</span>
      <h2>Finalizar pedido</h2>
      <p>Seus dados ficam salvos neste dispositivo para o proximo pedido.</p>
    </div>
    <form id="checkout-form" class="dialog-form">
      <label>Seu nome<input name="customer" required value="${esc(cached.name || '')}" placeholder="Como podemos chamar voce?"></label>
      <label>Telefone<input name="phone" required value="${esc(cached.phone || '')}" placeholder="(00) 00000-0000"></label>
      <label>Forma de recebimento<select name="fulfillment">${modes}</select></label>
      <label class="address-field">Endereco de entrega<input name="address" value="${esc(cached.address || '')}" placeholder="Rua, numero e complemento"></label>
      <label>Pagamento<select name="payment"><option>Pix</option><option>Cartao na entrega</option><option>Dinheiro</option></select></label>
      <button class="primary-button">Enviar pedido</button>
    </form>
  `);

  const form = document.querySelector('#checkout-form');
  form.onsubmit = (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const fulfillment = String(data.get('fulfillment') || 'pickup');
    const address = String(data.get('address') || '').trim();

    if (fulfillment === 'delivery' && !address) {
      notify('Informe o endereco de entrega.');
      return;
    }

    const customer = String(data.get('customer') || '').trim();
    const phone = String(data.get('phone') || '').trim();
    if (!customer || !phone) {
      notify('Informe seu nome e telefone para continuar.');
      return;
    }

    const total = state.cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
    const minutes = fulfillment === 'delivery' ? Number(state.delivery.deliveryMinutes || 45) : Number(state.delivery.pickupMinutes || 20);
    const orderItems = state.cart.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      notes: item.notes,
      price: item.price,
      photo: item.photo || ''
    }));

    localStorage.setItem(clientKey, JSON.stringify({ name: customer, phone, address }));

    const order = {
      id: `#${Date.now().toString().slice(-4)}`,
      customer,
      phone,
      address,
      payment: String(data.get('payment') || 'Pix'),
      fulfillment,
      status: state.delivery.autoAccept ? 'Em preparo' : 'Aguardando',
      total,
      items: orderItems,
      notes: orderItems.filter((item) => item.notes).map((item) => `${item.name}: ${item.notes}`).join(' | '),
      createdAt: Date.now(),
      readyAt: Date.now() + minutes * 60000,
      updatedAt: Date.now()
    };

    state.orders.push(order);
    state.cart = [];
    save();
    void persistOrderToSupabase(order);
    closeDialog();
    render();
    notify('Pedido enviado com sucesso!');
  };
}

function customerChat() {
  markMessagesAsRead('customer', 'store');
  document.querySelectorAll('.chat-badge').forEach((badge) => badge.remove());
  const storeMessages = state.messages.filter((msg) => msg.scope === 'store' || msg.from === 'merchant');
  showDialog(`
    <div class="dialog-head">
      <span class="category-icon">Chat</span>
      <h2>Falar com a loja</h2>
      <p>Envie uma duvida e a loja respondera por aqui.</p>
    </div>
    <div class="chat-messages compact">
      ${storeMessages.length ? storeMessages.map((msg) => `<div class="message ${msg.from === 'customer' ? 'mine' : ''}">${esc(msg.text)}<small>${esc(msg.time)}</small></div>`).join('') : '<p>Nenhuma mensagem ainda.</p>'}
    </div>
    <form id="customer-chat" class="chat-compose">
      <input name="message" required placeholder="Escreva sua duvida...">
      <button>Enviar</button>
    </form>
  `);

  document.querySelector('#customer-chat').onsubmit = (event) => {
    event.preventDefault();
    const input = event.currentTarget.elements.message;
    const text = String(input.value || '').trim();
    if (!text) return;

    state.messages.push({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      from: 'customer',
      text,
      time: nowTime(),
      scope: 'store'
    });
    save();
    void persistMessageToSupabase(state.messages[state.messages.length - 1]);
    closeDialog();
    notify('Mensagem enviada para a loja');
  };
}

function nowTime() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

render();
startLiveRefresh();

document.addEventListener('change', (event) => {
  if (event.target.matches('[data-delivery]')) {
    state.delivery[event.target.dataset.delivery] = event.target.checked;
    save();
  }

  if (event.target.matches('[data-auto-accept]')) {
    state.delivery.autoAccept = event.target.checked;
    save();
    render();
  }

  if (event.target.matches('[data-printer-field]')) {
    const field = event.target.dataset.printerField;
    if (event.target.type === 'checkbox') {
      state.printerConfig[field] = event.target.checked;
    } else if (field === 'copies') {
      state.printerConfig[field] = Number(event.target.value || 1);
    } else {
      state.printerConfig[field] = event.target.value;
    }
    save();
  }
});

document.addEventListener('click', (event) => {
  const viewButton = event.target.closest('[data-customer-view]');
  if (viewButton) {
    state.customerView = viewButton.dataset.customerView;
    save();
    customerShop();
    return;
  }

  const button = event.target.closest('[data-action]');
  if (!button) return;

  if (button.dataset.action === 'confirm-receipt') {
    const order = state.orders.find((item) => item.id === button.dataset.id);
    if (order) {
      order.confirmed = true;
      save();
      render();
      notify('Recebimento confirmado. Obrigado!');
    }
  }

  if (button.dataset.action === 'rate-order') {
    const order = state.orders.find((item) => item.id === button.dataset.id);
    if (!order) return;

    showDialog(`
      <div class="dialog-head">
        <span class="category-icon">Nota</span>
        <h2>Avalie seu pedido</h2>
        <p>Conte como foi a experiencia com a loja.</p>
      </div>
      <form id="rating-form" class="dialog-form">
        <label>Nota<select name="value"><option value="5">5 - Excelente</option><option value="4">4 - Muito bom</option><option value="3">3 - Bom</option><option value="2">2 - Pode melhorar</option><option value="1">1 - Ruim</option></select></label>
        <label>Comentario<textarea name="comment" placeholder="Escreva uma mensagem para a loja"></textarea></label>
        <label>Foto ou video (opcional)<input type="file" accept="image/*,video/*"></label>
        <button class="primary-button">Enviar avaliacao</button>
      </form>
    `);

    document.querySelector('#rating-form').onsubmit = (ratingEvent) => {
      ratingEvent.preventDefault();
      const data = new FormData(ratingEvent.currentTarget);
      state.ratings.push({
        orderId: order.id,
        value: Number(data.get('value') || 5),
        comment: String(data.get('comment') || '').trim(),
        createdAt: Date.now()
      });
      order.rated = true;
      save();
      closeDialog();
      notify('Avaliacao enviada para a loja');
      customerShop();
    };
  }
});
window.addEventListener('DOMContentLoaded', bootstrap);