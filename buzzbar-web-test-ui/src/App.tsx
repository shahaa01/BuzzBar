import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';

type SectionKey =
  | 'system'
  | 'auth'
  | 'me'
  | 'catalog'
  | 'cart'
  | 'promotions'
  | 'kyc'
  | 'orders'
  | 'payments';

type SessionState = {
  baseUrl: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
};

type ApiLogEntry = {
  id: string;
  ts: string;
  method: string;
  url: string;
  status?: number;
  ok: boolean;
  requestBody?: unknown;
  responseBody?: unknown;
  errorText?: string;
};

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  auth?: 'access' | 'refresh' | 'none';
  logoutWithRefresh?: boolean;
  formData?: FormData;
};

type KycDobHelperMode =
  | 'manual'
  | 'ad_numeric'
  | 'ad_passport'
  | 'ad_passport_inverted'
  | 'bs_numeric'
  | 'none';

const STORAGE_KEY = 'bb_web_test_ui_session';
const DEFAULT_BASE_URL = 'http://localhost:3000';
const MONTH_OPTIONS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

const NAV: Array<{ key: SectionKey; label: string; help: string }> = [
  { key: 'system', label: 'System', help: 'Health and readiness' },
  { key: 'auth', label: 'Auth', help: 'Signup, login, refresh, logout' },
  { key: 'me', label: 'Me', help: 'Profile read and update' },
  { key: 'catalog', label: 'Catalog', help: 'Public browse and product detail' },
  { key: 'cart', label: 'Cart', help: 'Cart add/update/remove/clear' },
  { key: 'promotions', label: 'Promotions', help: 'Promo validation' },
  { key: 'kyc', label: 'KYC', help: 'Submit and inspect KYC state' },
  { key: 'orders', label: 'Orders', help: 'Create and inspect customer orders' },
  { key: 'payments', label: 'Payments', help: 'Wallet init and confirm' }
];

function loadSession(): SessionState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { baseUrl: DEFAULT_BASE_URL, accessToken: '', refreshToken: '', userId: '' };
    }
    const parsed = JSON.parse(raw) as Partial<SessionState>;
    return {
      baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim() ? parsed.baseUrl : DEFAULT_BASE_URL,
      accessToken: typeof parsed.accessToken === 'string' ? parsed.accessToken : '',
      refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : '',
      userId: typeof parsed.userId === 'string' ? parsed.userId : ''
    };
  } catch {
    return { baseUrl: DEFAULT_BASE_URL, accessToken: '', refreshToken: '', userId: '' };
  }
}

function saveSession(session: SessionState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function tryParseJson(value: string) {
  if (!value.trim()) return undefined;
  return JSON.parse(value);
}

function padTwo(value: string) {
  return value.trim().padStart(2, '0');
}

function buildClientDobRaw(opts: {
  mode: KycDobHelperMode;
  manualRaw: string;
  year: string;
  monthNumber: string;
  monthToken: string;
  day: string;
}) {
  switch (opts.mode) {
    case 'none':
      return '';
    case 'manual':
      return opts.manualRaw.trim();
    case 'ad_numeric':
      if (!opts.year.trim() || !opts.monthNumber.trim() || !opts.day.trim()) return '';
      return `${opts.year.trim()}-${padTwo(opts.monthNumber)}-${padTwo(opts.day)}`;
    case 'ad_passport':
      if (!opts.year.trim() || !opts.monthToken.trim() || !opts.day.trim()) return '';
      return `${padTwo(opts.day)} ${opts.monthToken.trim().toUpperCase()} ${opts.year.trim()}`;
    case 'ad_passport_inverted':
      if (!opts.year.trim() || !opts.monthToken.trim() || !opts.day.trim()) return '';
      return `${opts.year.trim()} ${opts.monthToken.trim().toUpperCase()} ${padTwo(opts.day)}`;
    case 'bs_numeric':
      if (!opts.year.trim() || !opts.monthNumber.trim() || !opts.day.trim()) return '';
      return `${opts.year.trim()}-${padTwo(opts.monthNumber)}-${padTwo(opts.day)} BS`;
    default:
      return '';
  }
}

function badgeClass(entry: ApiLogEntry) {
  if (entry.ok) return 'pill ok';
  if (entry.status && entry.status < 500) return 'pill warn';
  return 'pill error';
}

function SectionCard(props: { title: string; help?: string; children: ReactNode }) {
  return (
    <section className="card">
      <h3>{props.title}</h3>
      {props.help ? <p className="card-help">{props.help}</p> : null}
      {props.children}
    </section>
  );
}

function JsonPanel(props: { title: string; value: unknown }) {
  return (
    <div className="response-box">
      <div className="response-header">
        <strong>{props.title}</strong>
      </div>
      <pre>{pretty(props.value)}</pre>
    </div>
  );
}

export default function App() {
  const [current, setCurrent] = useState<SectionKey>('system');
  const [session, setSession] = useState<SessionState>(() => loadSession());
  const [logs, setLogs] = useState<ApiLogEntry[]>([]);
  const [busyKey, setBusyKey] = useState<string>('');

  useEffect(() => {
    saveSession(session);
  }, [session]);

  async function callApi(key: string, options: RequestOptions) {
    const method = options.method ?? 'GET';
    const url = `${session.baseUrl.replace(/\/+$/, '')}${options.path}`;
    const headers: Record<string, string> = { ...(options.headers ?? {}) };

    if (options.formData) {
      // let browser set multipart boundary
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (options.auth === 'access' && session.accessToken) {
      headers.Authorization = `Bearer ${session.accessToken}`;
    }
    if (options.auth === 'refresh' && session.refreshToken) {
      headers.Authorization = `Bearer ${session.refreshToken}`;
    }
    if (options.logoutWithRefresh && session.refreshToken) {
      headers['x-refresh-token'] = session.refreshToken;
    }

    const requestBody = options.formData
      ? Object.fromEntries(Array.from(options.formData.entries()).map(([k, v]) => [k, typeof v === 'string' ? v : v.name]))
      : options.body;

    setBusyKey(key);

    let entry: ApiLogEntry;
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: options.formData ? options.formData : options.body !== undefined ? JSON.stringify(options.body) : undefined
      });

      const text = await response.text();
      let json: unknown = text;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }

      if (typeof json === 'object' && json && 'data' in (json as Record<string, unknown>)) {
        const data = (json as { data?: any }).data;
        if (data?.token || data?.refreshToken || data?.user?._id || data?.user?.id) {
          setSession((prev) => ({
            ...prev,
            accessToken: typeof data?.token === 'string' ? data.token : prev.accessToken,
            refreshToken: typeof data?.refreshToken === 'string' ? data.refreshToken : prev.refreshToken,
            userId: typeof data?.user?._id === 'string' ? data.user._id : typeof data?.user?.id === 'string' ? data.user.id : prev.userId
          }));
        }
      }

      if (options.path === '/api/v1/auth/logout' && response.ok) {
        setSession((prev) => ({ ...prev, accessToken: '', refreshToken: '', userId: '' }));
      }

      entry = {
        id: `${Date.now()}-${Math.random()}`,
        ts: new Date().toISOString(),
        method,
        url,
        status: response.status,
        ok: response.ok,
        requestBody,
        responseBody: json
      };
    } catch (error) {
      entry = {
        id: `${Date.now()}-${Math.random()}`,
        ts: new Date().toISOString(),
        method,
        url,
        ok: false,
        requestBody,
        errorText: error instanceof Error ? error.message : String(error)
      };
    } finally {
      setBusyKey('');
    }

    setLogs((prev) => [entry, ...prev].slice(0, 40));
    return entry;
  }

  const latestLog = logs[0];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>BuzzBar Web Test UI</h1>
        <p>Minimal visuals. Full customer and public API exercise surface. No admin flows here.</p>

        <div className="sidebar-group">
          <div className="sidebar-group-title">Environment</div>
          <div className="field">
            <label htmlFor="baseUrl">API base URL</label>
            <input
              id="baseUrl"
              value={session.baseUrl}
              onChange={(e) => setSession((prev) => ({ ...prev, baseUrl: e.target.value }))}
            />
          </div>
        </div>

        <div className="sidebar-group">
          <div className="sidebar-group-title">Session</div>
          <div className="token-box">
            <pre>{pretty({ accessToken: session.accessToken || '(empty)', refreshToken: session.refreshToken || '(empty)', userId: session.userId || '(empty)' })}</pre>
          </div>
          <div className="actions" style={{ marginTop: 10 }}>
            <button className="button secondary" onClick={() => setSession((prev) => ({ ...prev, accessToken: '', refreshToken: '', userId: '' }))}>
              Clear tokens
            </button>
          </div>
        </div>

        <div className="sidebar-group">
          <div className="sidebar-group-title">Modules</div>
          {NAV.map((item) => (
            <button key={item.key} className={`nav-button ${current === item.key ? 'active' : ''}`} onClick={() => setCurrent(item.key)}>
              <div>{item.label}</div>
              <div className="muted" style={{ fontSize: 12 }}>{item.help}</div>
            </button>
          ))}
        </div>
      </aside>

      <main className="main">
        <div className="page-header">
          <div>
            <h2>{NAV.find((item) => item.key === current)?.label}</h2>
            <p>{NAV.find((item) => item.key === current)?.help}</p>
          </div>
          <div className="meta-row">
            <span className="pill">{session.baseUrl}</span>
            <span className={`pill ${busyKey ? 'warn' : 'ok'}`}>{busyKey ? `Running ${busyKey}` : 'Idle'}</span>
          </div>
        </div>

        {current === 'system' ? <SystemPage callApi={callApi} latestLog={latestLog} /> : null}
        {current === 'auth' ? <AuthPage callApi={callApi} session={session} setSession={setSession} /> : null}
        {current === 'me' ? <MePage callApi={callApi} session={session} /> : null}
        {current === 'catalog' ? <CatalogPage callApi={callApi} /> : null}
        {current === 'cart' ? <CartPage callApi={callApi} /> : null}
        {current === 'promotions' ? <PromotionsPage callApi={callApi} /> : null}
        {current === 'kyc' ? <KycPage callApi={callApi} /> : null}
        {current === 'orders' ? <OrdersPage callApi={callApi} /> : null}
        {current === 'payments' ? <PaymentsPage callApi={callApi} /> : null}

        <div className="stack" style={{ marginTop: 24 }}>
          <SectionCard title="Request log" help="Latest 40 requests. Use this to verify exact payload/response behavior while testing flows.">
            <div className="stack">
              {logs.length === 0 ? <div className="muted">No requests yet.</div> : null}
              {logs.map((log) => (
                <div key={log.id} className="response-box">
                  <div className="response-header">
                    <div>
                      <strong>{log.method}</strong> <span className="muted">{log.url}</span>
                    </div>
                    <span className={badgeClass(log)}>
                      {log.status ? `${log.status}` : 'NETWORK'} · {log.ok ? 'OK' : 'FAIL'}
                    </span>
                  </div>
                  <div className="meta-row" style={{ marginBottom: 10 }}>
                    <span>{new Date(log.ts).toLocaleString()}</span>
                  </div>
                  {log.requestBody !== undefined ? <pre>{pretty({ request: log.requestBody })}</pre> : null}
                  {log.responseBody !== undefined ? <pre>{pretty({ response: log.responseBody })}</pre> : null}
                  {log.errorText ? <pre>{pretty({ error: log.errorText })}</pre> : null}
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </main>
    </div>
  );
}

function SystemPage(props: { callApi: (key: string, options: RequestOptions) => Promise<ApiLogEntry>; latestLog?: ApiLogEntry }) {
  return (
    <div className="stack">
      <SectionCard title="Health and readiness" help="Quick smoke checks before testing deeper flows.">
        <div className="actions">
          <button className="button" onClick={() => void props.callApi('health', { path: '/health' })}>GET /health</button>
          <button className="button secondary" onClick={() => void props.callApi('ready', { path: '/ready' })}>GET /ready</button>
        </div>
      </SectionCard>
      {props.latestLog ? <JsonPanel title="Latest response" value={props.latestLog} /> : null}
    </div>
  );
}

function AuthPage(props: {
  callApi: (key: string, options: RequestOptions) => Promise<ApiLogEntry>;
  session: SessionState;
  setSession: React.Dispatch<React.SetStateAction<SessionState>>;
}) {
  const [signup, setSignup] = useState({ email: '', password: '', name: '' });
  const [login, setLogin] = useState({ email: '', password: '' });
  const [googleIdToken, setGoogleIdToken] = useState('');
  const [appleIdentityToken, setAppleIdentityToken] = useState('');

  return (
    <div className="stack">
      <div className="grid two">
        <SectionCard title="Signup" help="Creates a password-based customer account and stores returned access/refresh tokens automatically.">
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              void props.callApi('signup', { method: 'POST', path: '/api/v1/auth/signup', body: signup });
            }}
          >
            <div className="field"><label>Email</label><input value={signup.email} onChange={(e) => setSignup((p) => ({ ...p, email: e.target.value }))} /></div>
            <div className="field"><label>Password</label><input type="password" value={signup.password} onChange={(e) => setSignup((p) => ({ ...p, password: e.target.value }))} /></div>
            <div className="field"><label>Name</label><input value={signup.name} onChange={(e) => setSignup((p) => ({ ...p, name: e.target.value }))} /></div>
            <div className="actions"><button className="button">POST /auth/signup</button></div>
          </form>
        </SectionCard>

        <SectionCard title="Login" help="Logs in an existing password user and updates current session tokens.">
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              void props.callApi('login', { method: 'POST', path: '/api/v1/auth/login', body: login });
            }}
          >
            <div className="field"><label>Email</label><input value={login.email} onChange={(e) => setLogin((p) => ({ ...p, email: e.target.value }))} /></div>
            <div className="field"><label>Password</label><input type="password" value={login.password} onChange={(e) => setLogin((p) => ({ ...p, password: e.target.value }))} /></div>
            <div className="actions"><button className="button">POST /auth/login</button></div>
          </form>
        </SectionCard>
      </div>

      <div className="grid two">
        <SectionCard title="OAuth test hooks" help="Direct token passthrough for backend Google/Apple verification endpoints. Use real provider tokens if available.">
          <div className="stack">
            <div className="field">
              <label>Google ID token</label>
              <textarea value={googleIdToken} onChange={(e) => setGoogleIdToken(e.target.value)} />
            </div>
            <div className="actions">
              <button className="button" onClick={() => void props.callApi('google-auth', { method: 'POST', path: '/api/v1/auth/google', body: { idToken: googleIdToken } })}>
                POST /auth/google
              </button>
            </div>

            <div className="field">
              <label>Apple identity token</label>
              <textarea value={appleIdentityToken} onChange={(e) => setAppleIdentityToken(e.target.value)} />
            </div>
            <div className="actions">
              <button className="button secondary" onClick={() => void props.callApi('apple-auth', { method: 'POST', path: '/api/v1/auth/apple', body: { identityToken: appleIdentityToken } })}>
                POST /auth/apple
              </button>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Session controls" help="Refresh uses the refresh token in Authorization. Logout sends both access and refresh tokens.">
          <div className="actions">
            <button className="button" onClick={() => void props.callApi('refresh', { method: 'POST', path: '/api/v1/auth/refresh', auth: 'refresh' })}>
              POST /auth/refresh
            </button>
            <button className="button danger" onClick={() => void props.callApi('logout', { method: 'POST', path: '/api/v1/auth/logout', auth: 'access', logoutWithRefresh: true })}>
              POST /auth/logout
            </button>
            <button className="button secondary" onClick={() => props.setSession((prev) => ({ ...prev, accessToken: '', refreshToken: '', userId: '' }))}>
              Clear local session only
            </button>
          </div>
          <JsonPanel title="Current session" value={props.session} />
        </SectionCard>
      </div>
    </div>
  );
}

function MePage(props: { callApi: (key: string, options: RequestOptions) => Promise<ApiLogEntry>; session: SessionState }) {
  const [form, setForm] = useState({ name: '', phone: '', photoUrl: '' });
  return (
    <div className="grid two">
      <SectionCard title="Current profile" help="Requires access token. Useful to verify signup/login/refresh state.">
        <div className="actions">
          <button className="button" onClick={() => void props.callApi('me-get', { path: '/api/v1/me', auth: 'access' })}>
            GET /me
          </button>
        </div>
        <JsonPanel title="Session tokens in use" value={{ accessTokenPresent: Boolean(props.session.accessToken), refreshTokenPresent: Boolean(props.session.refreshToken), userId: props.session.userId || null }} />
      </SectionCard>

      <SectionCard title="Update profile" help="Name, phone and photoUrl only.">
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void props.callApi('me-update', { method: 'PUT', path: '/api/v1/me', auth: 'access', body: form });
          }}
        >
          <div className="field"><label>Name</label><input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></div>
          <div className="field"><label>Phone</label><input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} /></div>
          <div className="field"><label>Photo URL</label><input value={form.photoUrl} onChange={(e) => setForm((p) => ({ ...p, photoUrl: e.target.value }))} /></div>
          <div className="actions"><button className="button">PUT /me</button></div>
        </form>
      </SectionCard>
    </div>
  );
}

function CatalogPage(props: { callApi: (key: string, options: RequestOptions) => Promise<ApiLogEntry> }) {
  const [productsQuery, setProductsQuery] = useState({
    q: '',
    category: '',
    brand: '',
    minPrice: '',
    maxPrice: '',
    minAbv: '',
    maxAbv: '',
    volumeMl: '',
    inStock: '',
    sort: 'newest',
    page: '1',
    limit: '20'
  });
  const [productId, setProductId] = useState('');

  const productSearchPath = useMemo(() => {
    const sp = new URLSearchParams();
    Object.entries(productsQuery).forEach(([key, value]) => {
      if (value) sp.set(key, value);
    });
    return `/api/v1/products${sp.toString() ? `?${sp.toString()}` : ''}`;
  }, [productsQuery]);

  return (
    <div className="stack">
      <div className="grid three">
        <SectionCard title="Categories">
          <button className="button" onClick={() => void props.callApi('categories', { path: '/api/v1/categories' })}>GET /categories</button>
        </SectionCard>
        <SectionCard title="Brands">
          <button className="button" onClick={() => void props.callApi('brands', { path: '/api/v1/brands' })}>GET /brands</button>
        </SectionCard>
        <SectionCard title="Product detail">
          <div className="field"><label>Product ID or slug</label><input value={productId} onChange={(e) => setProductId(e.target.value)} /></div>
          <div className="actions">
            <button className="button" onClick={() => void props.callApi('product-detail', { path: `/api/v1/products/${encodeURIComponent(productId.trim())}` })}>
              GET /products/:id
            </button>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Products search" help="Public product list with query filters. Use IDs or slugs for category/brand filters as supported by backend.">
        <div className="form-grid">
          {Object.entries(productsQuery).map(([key, value]) => (
            <div className="field" key={key}>
              <label>{key}</label>
              {key === 'sort' ? (
                <select value={value} onChange={(e) => setProductsQuery((p) => ({ ...p, [key]: e.target.value }))}>
                  <option value="newest">newest</option>
                  <option value="price_asc">price_asc</option>
                  <option value="price_desc">price_desc</option>
                </select>
              ) : key === 'inStock' ? (
                <select value={value} onChange={(e) => setProductsQuery((p) => ({ ...p, [key]: e.target.value }))}>
                  <option value="">(unset)</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input value={value} onChange={(e) => setProductsQuery((p) => ({ ...p, [key]: e.target.value }))} />
              )}
            </div>
          ))}
        </div>
        <div className="actions">
          <button className="button" onClick={() => void props.callApi('products-search', { path: productSearchPath })}>
            GET /products
          </button>
        </div>
      </SectionCard>
    </div>
  );
}

function CartPage(props: { callApi: (key: string, options: RequestOptions) => Promise<ApiLogEntry> }) {
  const [addForm, setAddForm] = useState({ variantId: '', qty: '1' });
  const [updateForm, setUpdateForm] = useState({ variantId: '', qty: '0' });
  const [removeVariantId, setRemoveVariantId] = useState('');
  const [orderForm, setOrderForm] = useState({
    paymentMethod: 'COD',
    promoCode: '',
    label: 'Home',
    fullAddress: 'Baluwatar, Kathmandu',
    area: 'Kathmandu',
    landmark: 'Near school',
    contactName: 'Test User',
    contactPhone: '9800000000'
  });
  const [lastOrderFlags, setLastOrderFlags] = useState<unknown>(null);

  return (
    <div className="stack">
      <SectionCard title="Cart summary" help="All cart endpoints require customer auth.">
        <div className="actions">
          <button className="button" onClick={() => void props.callApi('cart-get', { path: '/api/v1/cart', auth: 'access' })}>
            GET /cart
          </button>
          <button className="button secondary" onClick={() => void props.callApi('cart-clear', { method: 'POST', path: '/api/v1/cart/clear', auth: 'access' })}>
            POST /cart/clear
          </button>
        </div>
      </SectionCard>

      <div className="grid three">
        <SectionCard title="Add item">
          <form className="form-grid single" onSubmit={(e) => {
            e.preventDefault();
            void props.callApi('cart-add', { method: 'POST', path: '/api/v1/cart/items', auth: 'access', body: { variantId: addForm.variantId, qty: Number(addForm.qty) } });
          }}>
            <div className="field"><label>Variant ID</label><input value={addForm.variantId} onChange={(e) => setAddForm((p) => ({ ...p, variantId: e.target.value }))} /></div>
            <div className="field"><label>Qty</label><input value={addForm.qty} onChange={(e) => setAddForm((p) => ({ ...p, qty: e.target.value }))} /></div>
            <div className="actions"><button className="button">POST /cart/items</button></div>
          </form>
        </SectionCard>

        <SectionCard title="Update item">
          <form className="form-grid single" onSubmit={(e) => {
            e.preventDefault();
            void props.callApi('cart-update', { method: 'PATCH', path: `/api/v1/cart/items/${encodeURIComponent(updateForm.variantId)}`, auth: 'access', body: { qty: Number(updateForm.qty) } });
          }}>
            <div className="field"><label>Variant ID</label><input value={updateForm.variantId} onChange={(e) => setUpdateForm((p) => ({ ...p, variantId: e.target.value }))} /></div>
            <div className="field"><label>Qty</label><input value={updateForm.qty} onChange={(e) => setUpdateForm((p) => ({ ...p, qty: e.target.value }))} /></div>
            <div className="actions"><button className="button">PATCH /cart/items/:variantId</button></div>
          </form>
        </SectionCard>

        <SectionCard title="Remove item">
          <div className="field"><label>Variant ID</label><input value={removeVariantId} onChange={(e) => setRemoveVariantId(e.target.value)} /></div>
          <div className="actions">
            <button className="button danger" onClick={() => void props.callApi('cart-remove', { method: 'DELETE', path: `/api/v1/cart/items/${encodeURIComponent(removeVariantId)}`, auth: 'access' })}>
              DELETE /cart/items/:variantId
            </button>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Order current cart" help="Creates an order directly from whatever is currently in the cart. Use this to test cart → order flow without switching modules.">
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              const entry = await props.callApi('cart-order-create', {
                method: 'POST',
                path: '/api/v1/orders',
                auth: 'access',
                body: {
                  paymentMethod: orderForm.paymentMethod,
                  promoCode: orderForm.promoCode.trim() || undefined,
                  address: {
                    label: orderForm.label.trim() || undefined,
                    fullAddress: orderForm.fullAddress,
                    area: orderForm.area,
                    landmark: orderForm.landmark.trim() || undefined,
                    contactName: orderForm.contactName.trim() || undefined,
                    contactPhone: orderForm.contactPhone.trim() || undefined
                  }
                }
              });
              const orderId = (entry.responseBody as { data?: { orderId?: string } } | undefined)?.data?.orderId;
              if (orderId) {
                const detail = await props.callApi('cart-order-created-detail', { path: `/api/v1/orders/${encodeURIComponent(orderId)}`, auth: 'access' });
                setLastOrderFlags((detail.responseBody as { data?: unknown } | undefined)?.data ?? null);
              }
            })();
          }}
        >
          <div className="field">
            <label>Payment method</label>
            <select value={orderForm.paymentMethod} onChange={(e) => setOrderForm((p) => ({ ...p, paymentMethod: e.target.value }))}>
              <option value="COD">COD</option>
              <option value="WALLET">WALLET</option>
            </select>
          </div>
          <div className="field">
            <label>Promo code (optional)</label>
            <input value={orderForm.promoCode} onChange={(e) => setOrderForm((p) => ({ ...p, promoCode: e.target.value }))} />
          </div>
          <div className="field">
            <label>Address label</label>
            <input value={orderForm.label} onChange={(e) => setOrderForm((p) => ({ ...p, label: e.target.value }))} />
          </div>
          <div className="field">
            <label>Service area</label>
            <input value={orderForm.area} onChange={(e) => setOrderForm((p) => ({ ...p, area: e.target.value }))} />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Full address</label>
            <input value={orderForm.fullAddress} onChange={(e) => setOrderForm((p) => ({ ...p, fullAddress: e.target.value }))} />
          </div>
          <div className="field">
            <label>Landmark</label>
            <input value={orderForm.landmark} onChange={(e) => setOrderForm((p) => ({ ...p, landmark: e.target.value }))} />
          </div>
          <div className="field">
            <label>Contact name</label>
            <input value={orderForm.contactName} onChange={(e) => setOrderForm((p) => ({ ...p, contactName: e.target.value }))} />
          </div>
          <div className="field">
            <label>Contact phone</label>
            <input value={orderForm.contactPhone} onChange={(e) => setOrderForm((p) => ({ ...p, contactPhone: e.target.value }))} />
          </div>
          <div className="actions">
            <button className="button">POST /orders from cart</button>
          </div>
        </form>
        <div className="stack">
          <div className="muted">After order creation, this test UI fetches order detail so you can inspect delivery-age-check flags.</div>
          {lastOrderFlags ? <JsonPanel title="Last created order detail" value={lastOrderFlags} /> : null}
        </div>
      </SectionCard>
    </div>
  );
}

function PromotionsPage(props: { callApi: (key: string, options: RequestOptions) => Promise<ApiLogEntry> }) {
  const [code, setCode] = useState('');
  const [itemsRaw, setItemsRaw] = useState('[\n  {\n    "variantId": "",\n    "qty": 1\n  }\n]');

  return (
    <div className="grid two">
      <SectionCard title="Validate against current cart">
        <div className="field"><label>Promo code</label><input value={code} onChange={(e) => setCode(e.target.value)} /></div>
        <div className="actions">
          <button className="button" onClick={() => void props.callApi('promo-validate-cart', { method: 'POST', path: '/api/v1/promotions/validate', auth: 'access', body: { code } })}>
            POST /promotions/validate (cart)
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Validate stateless items payload">
        <div className="field"><label>Promo code</label><input value={code} onChange={(e) => setCode(e.target.value)} /></div>
        <div className="field"><label>Items JSON</label><textarea value={itemsRaw} onChange={(e) => setItemsRaw(e.target.value)} /></div>
        <div className="actions">
          <button className="button secondary" onClick={() => void props.callApi('promo-validate-items', { method: 'POST', path: '/api/v1/promotions/validate', auth: 'access', body: { code, items: tryParseJson(itemsRaw) } })}>
            POST /promotions/validate (items)
          </button>
        </div>
      </SectionCard>
    </div>
  );
}

function KycPage(props: { callApi: (key: string, options: RequestOptions) => Promise<ApiLogEntry> }) {
  const [clientOcrText, setClientOcrText] = useState('');
  const [clientDobRaw, setClientDobRaw] = useState('');
  const [clientConfidence, setClientConfidence] = useState('');
  const [idFront, setIdFront] = useState<File | null>(null);
  const [idBack, setIdBack] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [dobMode, setDobMode] = useState<KycDobHelperMode>('manual');
  const [dobYear, setDobYear] = useState('');
  const [dobMonthNumber, setDobMonthNumber] = useState('');
  const [dobMonthToken, setDobMonthToken] = useState('JUN');
  const [dobDay, setDobDay] = useState('');
  const [lastClientSubmission, setLastClientSubmission] = useState<Record<string, unknown> | null>(null);
  const [lastBackendSummary, setLastBackendSummary] = useState<unknown>(null);
  const [lastStatusSummary, setLastStatusSummary] = useState<unknown>(null);

  const effectiveClientDobRaw = useMemo(
    () =>
      buildClientDobRaw({
        mode: dobMode,
        manualRaw: clientDobRaw,
        year: dobYear,
        monthNumber: dobMonthNumber,
        monthToken: dobMonthToken,
        day: dobDay
      }),
    [clientDobRaw, dobDay, dobMode, dobMonthNumber, dobMonthToken, dobYear]
  );

  async function submitKyc(e: FormEvent) {
    e.preventDefault();
    const formData = new FormData();
    if (idFront) formData.append('idFront', idFront);
    if (idBack) formData.append('idBack', idBack);
    if (selfie) formData.append('selfie', selfie);
    if (clientOcrText.trim()) formData.append('clientOcrText', clientOcrText);
    if (effectiveClientDobRaw.trim()) formData.append('clientDobRaw', effectiveClientDobRaw);
    if (clientConfidence.trim()) formData.append('clientConfidence', clientConfidence);
    const clientSnapshot = {
      dobHelperMode: dobMode,
      idFront: idFront?.name ?? null,
      idBack: idBack?.name ?? null,
      selfie: selfie?.name ?? null,
      clientOcrText: clientOcrText || null,
      clientDobRaw: effectiveClientDobRaw || null,
      clientConfidence: clientConfidence || null
    };
    setLastClientSubmission(clientSnapshot);
    const entry = await props.callApi('kyc-submit', { method: 'POST', path: '/api/v1/kyc/submit', auth: 'access', formData });
    const response = entry.responseBody as { data?: { attemptSummary?: unknown } } | undefined;
    setLastBackendSummary(response?.data?.attemptSummary ?? null);
  }

  return (
    <div className="stack">
      <SectionCard title="KYC status">
        <div className="actions">
          <button
            className="button"
            onClick={async () => {
              const entry = await props.callApi('kyc-status', { path: '/api/v1/kyc/status', auth: 'access' });
              const response = entry.responseBody as { data?: { attemptSummary?: unknown } } | undefined;
              setLastStatusSummary(response?.data?.attemptSummary ?? null);
            }}
          >
            GET /kyc/status
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Submit KYC" help="Multipart form. `idFront` is required by backend.">
        <form className="form-grid" onSubmit={(e) => void submitKyc(e)}>
          <div className="field"><label>ID front</label><input type="file" accept="image/*" onChange={(e) => setIdFront(e.target.files?.[0] ?? null)} /></div>
          <div className="field"><label>ID back</label><input type="file" accept="image/*" onChange={(e) => setIdBack(e.target.files?.[0] ?? null)} /></div>
          <div className="field"><label>Selfie</label><input type="file" accept="image/*" onChange={(e) => setSelfie(e.target.files?.[0] ?? null)} /></div>
          <div className="field"><label>Client confidence (0-1)</label><input value={clientConfidence} onChange={(e) => setClientConfidence(e.target.value)} /></div>
          <div className="field">
            <label>Client DOB helper mode</label>
            <select value={dobMode} onChange={(e) => setDobMode(e.target.value as KycDobHelperMode)}>
              <option value="manual">Manual raw</option>
              <option value="ad_numeric">Structured AD numeric</option>
              <option value="ad_passport">Structured AD passport-style</option>
              <option value="ad_passport_inverted">Structured AD passport-style inverted</option>
              <option value="bs_numeric">Structured BS numeric</option>
              <option value="none">No explicit client DOB</option>
            </select>
          </div>

          {dobMode === 'manual' ? (
            <div className="field">
              <label>Client DOB raw</label>
              <input value={clientDobRaw} onChange={(e) => setClientDobRaw(e.target.value)} placeholder="e.g. 20 JUN 1978 or 2046-04-08 BS" />
            </div>
          ) : null}

          {dobMode === 'ad_numeric' || dobMode === 'bs_numeric' ? (
            <>
              <div className="field"><label>Year</label><input value={dobYear} onChange={(e) => setDobYear(e.target.value)} placeholder={dobMode === 'bs_numeric' ? '2046' : '1978'} /></div>
              <div className="field"><label>Month</label><input value={dobMonthNumber} onChange={(e) => setDobMonthNumber(e.target.value)} placeholder="06" /></div>
              <div className="field"><label>Day</label><input value={dobDay} onChange={(e) => setDobDay(e.target.value)} placeholder="20" /></div>
            </>
          ) : null}

          {dobMode === 'ad_passport' || dobMode === 'ad_passport_inverted' ? (
            <>
              <div className="field"><label>Year</label><input value={dobYear} onChange={(e) => setDobYear(e.target.value)} placeholder="1978" /></div>
              <div className="field">
                <label>Month token</label>
                <select value={dobMonthToken} onChange={(e) => setDobMonthToken(e.target.value)}>
                  {MONTH_OPTIONS.map((month) => (
                    <option key={month} value={month}>{month}</option>
                  ))}
                </select>
              </div>
              <div className="field"><label>Day</label><input value={dobDay} onChange={(e) => setDobDay(e.target.value)} placeholder="20" /></div>
            </>
          ) : null}

          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Client DOB preview</label>
            <input value={effectiveClientDobRaw} readOnly placeholder="No client DOB will be sent" />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label>Client OCR text</label><textarea value={clientOcrText} onChange={(e) => setClientOcrText(e.target.value)} /></div>
          <div className="actions"><button className="button">POST /kyc/submit</button></div>
        </form>
      </SectionCard>

      <div className="grid two">
        <SectionCard
          title="Client-side submitted KYC data"
          help="What this test UI actually sent to the backend. This is the client-side side of the comparison."
        >
          {lastClientSubmission ? <JsonPanel title="Client submission" value={lastClientSubmission} /> : <div className="muted">No KYC submission captured yet.</div>}
        </SectionCard>

        <SectionCard
          title="Backend-derived interpretation"
          help="Parsed DOB, server OCR, confidence, age decision, tolerance outcome, and review-required reason as returned by the backend."
        >
          {lastBackendSummary || lastStatusSummary ? (
            <div className="stack">
              {lastBackendSummary ? <JsonPanel title="From submit response" value={lastBackendSummary} /> : null}
              {lastStatusSummary ? <JsonPanel title="From status endpoint" value={lastStatusSummary} /> : null}
            </div>
          ) : (
            <div className="muted">No backend KYC interpretation captured yet.</div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function OrdersPage(props: { callApi: (key: string, options: RequestOptions) => Promise<ApiLogEntry> }) {
  const [createBody, setCreateBody] = useState(`{
  "paymentMethod": "COD",
  "address": {
    "label": "Home",
    "fullAddress": "Baluwatar, Kathmandu",
    "area": "Kathmandu",
    "landmark": "Near school",
    "contactName": "Test User",
    "contactPhone": "9800000000"
  }
}`);
  const [listParams, setListParams] = useState({ page: '1', limit: '20' });
  const [orderId, setOrderId] = useState('');
  const [lastCreatedOrderDetail, setLastCreatedOrderDetail] = useState<unknown>(null);

  return (
    <div className="stack">
      <div className="grid two">
        <SectionCard title="Create order" help="Builds from current cart. Use COD or WALLET and test KYC/service-area/night-hour gates.">
          <div className="field"><label>Order JSON body</label><textarea value={createBody} onChange={(e) => setCreateBody(e.target.value)} /></div>
          <div className="actions">
            <button
              className="button"
              onClick={() =>
                void (async () => {
                  const entry = await props.callApi('order-create', { method: 'POST', path: '/api/v1/orders', auth: 'access', body: tryParseJson(createBody) });
                  const createdOrderId = (entry.responseBody as { data?: { orderId?: string } } | undefined)?.data?.orderId;
                  if (createdOrderId) {
                    setOrderId(createdOrderId);
                    const detail = await props.callApi('order-create-detail', { path: `/api/v1/orders/${encodeURIComponent(createdOrderId)}`, auth: 'access' });
                    setLastCreatedOrderDetail((detail.responseBody as { data?: unknown } | undefined)?.data ?? null);
                  }
                })()
              }
            >
              POST /orders
            </button>
          </div>
          {lastCreatedOrderDetail ? <JsonPanel title="Last created order detail" value={lastCreatedOrderDetail} /> : null}
        </SectionCard>

        <SectionCard title="List and detail">
          <div className="form-grid">
            <div className="field"><label>Page</label><input value={listParams.page} onChange={(e) => setListParams((p) => ({ ...p, page: e.target.value }))} /></div>
            <div className="field"><label>Limit</label><input value={listParams.limit} onChange={(e) => setListParams((p) => ({ ...p, limit: e.target.value }))} /></div>
            <div className="field"><label>Order ID</label><input value={orderId} onChange={(e) => setOrderId(e.target.value)} /></div>
          </div>
          <div className="actions">
            <button className="button" onClick={() => void props.callApi('orders-list', { path: `/api/v1/orders?page=${encodeURIComponent(listParams.page)}&limit=${encodeURIComponent(listParams.limit)}`, auth: 'access' })}>
              GET /orders
            </button>
            <button className="button secondary" onClick={() => void props.callApi('orders-detail', { path: `/api/v1/orders/${encodeURIComponent(orderId)}`, auth: 'access' })}>
              GET /orders/:id
            </button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function PaymentsPage(props: { callApi: (key: string, options: RequestOptions) => Promise<ApiLogEntry> }) {
  const [initBody, setInitBody] = useState(`{
  "orderId": "",
  "provider": "MOCK"
}`);
  const [confirmBody, setConfirmBody] = useState(`{
  "orderId": "",
  "provider": "MOCK",
  "payload": {
    "mode": "SUCCESS"
  }
}`);

  return (
    <div className="grid two">
      <SectionCard title="Payment init" help="Wallet orders only. Useful for MOCK provider lifecycle tests.">
        <div className="field"><label>Init JSON body</label><textarea value={initBody} onChange={(e) => setInitBody(e.target.value)} /></div>
        <div className="actions">
          <button className="button" onClick={() => void props.callApi('payments-init', { method: 'POST', path: '/api/v1/payments/init', auth: 'access', body: tryParseJson(initBody) })}>
            POST /payments/init
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Payment confirm" help="Pass mock payloads such as SUCCESS, FAILED, PENDING_THEN_SUCCESS, PENDING_THEN_FAILED.">
        <div className="field"><label>Confirm JSON body</label><textarea value={confirmBody} onChange={(e) => setConfirmBody(e.target.value)} /></div>
        <div className="actions">
          <button className="button secondary" onClick={() => void props.callApi('payments-confirm', { method: 'POST', path: '/api/v1/payments/confirm', auth: 'access', body: tryParseJson(confirmBody) })}>
            POST /payments/confirm
          </button>
        </div>
      </SectionCard>
    </div>
  );
}
