import { useState, useEffect, useCallback, useRef } from 'react';
import * as db from './utils/db';
import { parseInvoiceAI, generateReceiptAI, sendEmailFallback } from './utils/api';
import { uid, fmt, fmtDate, fmtTs, readFileAsBase64, openWhatsApp, openSMS, printHTML, buildReceiptText } from './utils/helpers';

const TABS = [
  { id: 'home', icon: '🏠', label: 'Home' },
  { id: 'inventory', icon: '📦', label: 'Stock' },
  { id: 'sold', icon: '💰', label: 'Sold' },
  { id: 'account', icon: '👤', label: 'Account' },
];

export default function App() {
  const [auth, setAuth] = useState('loading');
  const [user, setUser] = useState(null);
  const [af, setAf] = useState({ email: '', password: '', mode: 'login' });
  const [authErr, setAuthErr] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  const [tab, setTab] = useState('home');
  const [invoices, setInvoices] = useState([]);
  const [items, setItems] = useState([]);
  const [sold, setSold] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [biz, setBiz] = useState({ business_name: '', address: '', phone: '', email: '', hst: '' });
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState('');

  // Modals
  const [modal, setModal] = useState(null); // {type, data}
  const [receiptHtml, setReceiptHtml] = useState('');
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [viewInvUrl, setViewInvUrl] = useState(null);
  const [lcEvents, setLcEvents] = useState([]);
  const [itemPhotos, setItemPhotos] = useState({});
  const [sf, setSf] = useState({ amount: '', platform: '', buyer: '', buyerEmail: '', buyerPhone: '' });
  const fileRef = useRef(null);

  const notify = useCallback((type, msg) => { setToast({ type, msg }); setTimeout(() => setToast(null), 4000); }, []);
  const closeModal = () => { setModal(null); setReceiptHtml(''); setViewInvUrl(null); setLcEvents([]); setEmailTo(''); setSf({ amount: '', platform: '', buyer: '', buyerEmail: '', buyerPhone: '' }); };

  // Auth
  useEffect(() => {
    const { data: { subscription } } = db.onAuthChange((_, s) => { if (s?.user) { setUser(s.user); setAuth('app'); } else { setUser(null); setAuth('login'); } });
    db.getUser().then(u => { if (u) { setUser(u); setAuth('app'); } else setAuth('login'); });
    return () => subscription.unsubscribe();
  }, []);

  const handleAuth = useCallback(async () => {
    setAuthBusy(true); setAuthErr('');
    try {
      if (af.mode === 'login') await db.signIn(af.email, af.password);
      else { await db.signUp(af.email, af.password); notify('success', 'Check email to confirm!'); }
    } catch (e) { setAuthErr(e.message); }
    setAuthBusy(false);
  }, [af, notify]);

  // Load
  const load = useCallback(async () => {
    try {
      const [inv, itm, sld, cust, s] = await Promise.all([db.getInvoices(), db.getItems(), db.getSoldItems(), db.getCustomers(), db.getSettings()]);
      setInvoices(inv); setItems(itm); setSold(sld); setCustomers(cust);
      if (s) setBiz(s);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { if (auth === 'app') load(); }, [auth, load]);

  // Photos
  const loadPhotos = useCallback(async (id) => {
    try {
      const photos = await db.getPhotoUrls(id, null);
      setItemPhotos(p => ({ ...p, [id]: photos }));
    } catch (e) { console.error('Photo load err:', e); }
  }, []);

  const loadSoldPhotos = useCallback(async (id) => {
    try {
      const photos = await db.getPhotoUrls(null, id);
      setItemPhotos(p => ({ ...p, [id]: photos }));
    } catch (e) { console.error('Photo load err:', e); }
  }, []);

  // Upload Invoice
  const handleUpload = useCallback(async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    notify('info', 'Claude AI is reading your invoice...');
    try {
      const b64 = await readFileAsBase64(file);
      const result = await parseInvoiceAI(b64, file.type);
      const tempId = uid();
      const filePath = await db.uploadInvoiceFile(tempId, b64, file.name, file.type);
      const newInv = await db.insertInvoice({
        date: result.invoice.date, auction_house: result.invoice.auction_house, invoice_number: result.invoice.invoice_number,
        event_description: result.invoice.event_description, payment_method: result.invoice.payment_method,
        payment_status: result.invoice.payment_status, pickup_location: result.invoice.pickup_location,
        buyer_premium_rate: result.invoice.buyer_premium_rate, tax_rate: result.invoice.tax_rate,
        lot_total: result.invoice.lot_total, premium_total: result.invoice.premium_total,
        tax_total: result.invoice.tax_total, grand_total: result.invoice.grand_total,
        file_name: file.name, file_type: file.type, file_path: filePath, item_count: result.items.length,
      });
      const pr = result.invoice.buyer_premium_rate || 0, tr = result.invoice.tax_rate || 0.13;
      const rows = result.items.map(it => ({
        invoice_id: newInv.id, lot_number: it.lot_number, title: it.title, description: it.description,
        quantity: it.quantity || 1, hammer_price: it.hammer_price, premium_rate: pr, tax_rate: tr,
        premium_amount: +(it.hammer_price * pr).toFixed(2), subtotal: +(it.hammer_price * (1 + pr)).toFixed(2),
        tax_amount: +(it.hammer_price * (1 + pr) * tr).toFixed(2), total_cost: +(it.hammer_price * (1 + pr) * (1 + tr)).toFixed(2),
        auction_house: result.invoice.auction_house, date: result.invoice.date,
        pickup_location: result.invoice.pickup_location, payment_method: result.invoice.payment_method, status: 'in_inventory',
      }));
      const inserted = await db.insertItems(rows);
      const now = new Date().toISOString();
      await db.addLifecycleEvents(inserted.flatMap(it => [
        { item_id: it.id, event: 'Invoice Uploaded', detail: file.name, created_at: now },
        { item_id: it.id, event: 'AI Extracted', detail: `${result.items.length} items from ${result.invoice.auction_house}`, created_at: now },
        { item_id: it.id, event: 'In Inventory', detail: `Lot #${it.lot_number}`, created_at: now },
      ]));
      await load();
      notify('success', `${result.items.length} items added from ${result.invoice.auction_house}`);
    } catch (err) { notify('error', err.message); }
    if (fileRef.current) fileRef.current.value = '';
  }, [notify, load]);

  // Photo upload
  const handlePhoto = useCallback(async (itemId, e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    notify('info', `Uploading ${files.length} photo(s)...`);
    for (const f of files) {
      await db.uploadPhoto(itemId, f);
      await db.addLifecycleEvent({ item_id: itemId, event: 'Photo Added', detail: f.name });
    }
    await loadPhotos(itemId);
    notify('success', `${files.length} photo(s) saved`);
  }, [notify, loadPhotos]);

  // Sell
  const handleSell = useCallback(async () => {
    const item = modal?.data; if (!item || !sf.amount) return;
    const amt = parseFloat(sf.amount); if (isNaN(amt)) return;
    const rcpt = `RCP-${Date.now().toString(36).toUpperCase()}`;
    const profit = +(amt - parseFloat(item.total_cost)).toFixed(2);
    const pct = parseFloat(item.total_cost) > 0 ? +(profit / parseFloat(item.total_cost) * 100).toFixed(1) : 0;
    const soldData = {
      item_id: item.id, invoice_id: item.invoice_id, lot_number: item.lot_number, title: item.title,
      description: item.description, quantity: item.quantity, hammer_price: item.hammer_price,
      premium_rate: item.premium_rate, tax_rate: item.tax_rate, premium_amount: item.premium_amount,
      subtotal: item.subtotal, tax_amount: item.tax_amount, total_cost: item.total_cost,
      auction_house: item.auction_house, date: item.date, pickup_location: item.pickup_location,
      payment_method: item.payment_method, sold_price: amt, sold_platform: sf.platform,
      sold_buyer: sf.buyer, sold_buyer_email: sf.buyerEmail, sold_buyer_phone: sf.buyerPhone,
      receipt_number: rcpt, profit, profit_pct: pct,
    };
    const si = await db.insertSoldItem(soldData);
    await db.deleteItem(item.id);
    const oldLc = await db.getLifecycle(item.id, null);
    if (oldLc.length) await db.addLifecycleEvents(oldLc.map(e => ({ sold_item_id: si.id, event: e.event, detail: e.detail, created_at: e.created_at })));
    await db.addLifecycleEvent({ sold_item_id: si.id, event: 'Sold', detail: `${fmt(amt)}${sf.platform ? ` on ${sf.platform}` : ''}${sf.buyer ? ` to ${sf.buyer}` : ''} • ${rcpt}` });
    if (sf.buyer && !customers.find(c => c.name === sf.buyer)) await db.insertCustomer({ name: sf.buyer, email: sf.buyerEmail, phone: sf.buyerPhone });
    await load(); closeModal();
    notify('success', `Sold for ${fmt(amt)}! Receipt #${rcpt}`);
  }, [modal, sf, customers, load, notify]);

  // Receipt
  const handleReceipt = useCallback(async (si) => {
    setModal({ type: 'receipt', data: si }); setReceiptBusy(true); setReceiptHtml('');
    try {
      const b = { name: biz.business_name, address: biz.address, phone: biz.phone, email: biz.email, hst: biz.hst };
      const html = await generateReceiptAI(si, b, { name: si.sold_buyer || 'Walk-in', email: si.sold_buyer_email || '', phone: si.sold_buyer_phone || '' });
      setReceiptHtml(html);
      await db.updateSoldItem(si.id, { receipt_html: html });
      await db.addLifecycleEvent({ sold_item_id: si.id, event: 'Receipt Created', detail: si.receipt_number });
    } catch (err) { notify('error', err.message); closeModal(); }
    setReceiptBusy(false);
  }, [biz, notify]);

  // View invoice
  const handleViewInv = useCallback(async (inv) => {
    setModal({ type: 'viewInv', data: inv }); setViewInvUrl(null);
    if (inv.file_path) { const url = await db.getInvoiceFileUrl(inv.file_path); setViewInvUrl(url); }
  }, []);

  // Lifecycle
  const handleLifecycle = useCallback(async (item, isSold) => {
    setModal({ type: 'lifecycle', data: item });
    const evts = await db.getLifecycle(isSold ? null : item.id, isSold ? item.id : null);
    setLcEvents(evts);
  }, []);

  // Delete invoice
  const handleDelInv = useCallback(async (id) => {
    if (!confirm('Delete invoice and its items?')) return;
    await db.deleteItemsByInvoice(id); await db.deleteInvoice(id); await load();
    notify('success', 'Deleted');
  }, [load, notify]);

  // Email
  const handleEmail = useCallback(() => {
    if (!emailTo || !modal?.data) return;
    const si = modal.data;
    const b = { name: biz.business_name, address: biz.address, phone: biz.phone };
    sendEmailFallback(emailTo, `Receipt #${si.receipt_number} from ${biz.business_name}`, buildReceiptText(si, b));
    db.addLifecycleEvent({ sold_item_id: si.id, event: 'Emailed', detail: emailTo });
    notify('success', `Opening email to ${emailTo}`);
    closeModal();
  }, [emailTo, modal, biz, notify]);

  // Computed
  const totalSpent = [...items, ...sold].reduce((s, i) => s + parseFloat(i.total_cost || 0), 0);
  const totalRev = sold.reduce((s, i) => s + parseFloat(i.sold_price || 0), 0);
  const totalProfit = sold.reduce((s, i) => s + parseFloat(i.profit || 0), 0);
  const invValue = items.reduce((s, i) => s + parseFloat(i.total_cost || 0), 0);
  const filt = (arr) => arr.filter(i => { if (!search) return true; const t = search.toLowerCase(); return [i.title, i.description, i.auction_house, i.lot_number, i.sold_buyer].some(f => f?.toLowerCase?.().includes(t)); });

  // ═══ AUTH ═══
  if (auth === 'loading') return <div style={S.splash}><div style={S.spinner} /><p style={{ color: 'var(--text-muted)', marginTop: 12 }}>Loading...</p></div>;

  if (auth === 'login') return (
    <div style={S.splash}>
      <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 28, filter: 'brightness(10)' }}>⚡</span>
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Auction Vault</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>Track inventory & profits</p>
      <div style={{ width: '100%', maxWidth: 340, padding: '0 24px' }}>
        {authErr && <p style={{ color: 'var(--red)', fontSize: 13, textAlign: 'center', marginBottom: 8 }}>{authErr}</p>}
        <input style={S.input} type="email" placeholder="Email" value={af.email} onChange={e => setAf({ ...af, email: e.target.value })} />
        <input style={{ ...S.input, marginTop: 10 }} type="password" placeholder="Password" value={af.password} onChange={e => setAf({ ...af, password: e.target.value })} onKeyDown={e => e.key === 'Enter' && handleAuth()} />
        <button style={{ ...S.btnPrimary, width: '100%', marginTop: 16 }} onClick={handleAuth} disabled={authBusy}>{authBusy ? '...' : af.mode === 'login' ? 'Sign In' : 'Create Account'}</button>
        <button style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 13, marginTop: 12, width: '100%', textAlign: 'center', fontFamily: 'var(--font)' }} onClick={() => setAf({ ...af, mode: af.mode === 'login' ? 'signup' : 'login' })}>
          {af.mode === 'login' ? "Don't have an account? Sign up" : 'Have an account? Sign in'}
        </button>
      </div>
    </div>
  );

  // ═══ MAIN APP ═══
  return (
    <div style={S.app}>
      {/* TOAST */}
      {toast && <div className="fade-up" style={{ ...S.toast, background: toast.type === 'success' ? 'var(--green)' : toast.type === 'error' ? 'var(--red)' : 'var(--accent)' }}>{toast.type === 'info' && <div style={S.miniSpin} />}{toast.msg}</div>}

      <main style={S.main}>
        {/* ═══ HOME ═══ */}
        {tab === 'home' && <div>
          {/* Greeting */}
          <div style={{ padding: '20px 0 12px' }}>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Welcome back</p>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>Auction Vault</h1>
          </div>

          {/* Stats */}
          <div style={S.statsGrid}>
            <div style={{ ...S.statCard, borderLeft: '3px solid var(--accent)' }}>
              <p style={S.statLabel}>In Stock</p>
              <p style={S.statVal}>{items.length} <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>items</span></p>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{fmt(invValue)}</p>
            </div>
            <div style={{ ...S.statCard, borderLeft: '3px solid var(--green)' }}>
              <p style={S.statLabel}>Revenue</p>
              <p style={S.statVal}>{fmt(totalRev)}</p>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{sold.length} sold</p>
            </div>
            <div style={{ ...S.statCard, borderLeft: `3px solid ${totalProfit >= 0 ? 'var(--green)' : 'var(--red)'}` }}>
              <p style={S.statLabel}>Profit</p>
              <p style={{ ...S.statVal, color: totalProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>{totalProfit >= 0 ? '+' : ''}{fmt(totalProfit)}</p>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{totalSpent > 0 ? `${((totalProfit / totalSpent) * 100).toFixed(0)}% ROI` : '—'}</p>
            </div>
          </div>

          {/* Upload */}
          <label role="button" style={S.uploadCard}>
            <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={handleUpload} style={{ display: 'none' }} />
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 22, filter: 'brightness(10)' }}>📄</span>
            </div>
            <p style={{ fontSize: 16, fontWeight: 600 }}>Upload Invoice</p>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>PDF or photo — AI extracts all items</p>
          </label>

          {/* Recent Invoices */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '20px 0 10px' }}>
            <h2 style={{ fontSize: 17, fontWeight: 600 }}>Recent Invoices</h2>
            {invoices.length > 3 && <button style={S.linkBtn} onClick={() => setTab('inventory')}>See all</button>}
          </div>
          {invoices.length === 0 ? <p style={{ color: 'var(--text-muted)', fontSize: 14, padding: '20px 0', textAlign: 'center' }}>Upload your first invoice to get started</p> :
            invoices.slice(0, 5).map((inv, i) => (
              <div key={inv.id} className="fade-up" style={{ ...S.card, animationDelay: `${i * 50}ms`, marginBottom: 8 }}>
                <div style={S.cardRow} onClick={() => handleViewInv(inv)}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--accent-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ fontSize: 18 }}>📋</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.auction_house}</p>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{fmtDate(inv.date)} · {inv.item_count} items · {inv.invoice_number}</p>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>{fmt(inv.grand_total)}</p>
                    <Pill text={inv.payment_status || '?'} ok={inv.payment_status === 'Paid'} />
                  </div>
                </div>
                <div style={S.cardActions}>
                  <button style={S.chipBtn} onClick={() => handleViewInv(inv)}>👁 View</button>
                  <button style={{ ...S.chipBtn, color: 'var(--red)' }} onClick={() => handleDelInv(inv.id)}>Delete</button>
                </div>
              </div>
            ))
          }
        </div>}

        {/* ═══ INVENTORY ═══ */}
        {tab === 'inventory' && <div>
          <div style={{ padding: '20px 0 12px' }}>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>Inventory</h1>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{items.length} items · {fmt(invValue)} value</p>
          </div>
          <input style={{ ...S.input, marginBottom: 12 }} placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)} />

          {filt(items).length === 0 ? <Empty text={search ? 'No results' : 'Upload an invoice to add items'} /> :
            filt(items).map((item, i) => {
              const photos = itemPhotos[item.id] || [];
              return (
                <div key={item.id} className="fade-up" style={{ ...S.card, marginBottom: 10, animationDelay: `${i * 30}ms` }}>
                  <div style={S.cardRow}>
                    {/* Thumbnail */}
                    <div style={{ width: 56, height: 56, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      onClick={() => { setModal({ type: 'photos', data: item }); loadPhotos(item.id); }}>
                      {photos.length > 0 && photos[0].url ? <img src={photos[0].url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> :
                        <span style={{ fontSize: 22, color: 'var(--text-hint)' }}>📷</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</p>
                      <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.auction_house} · Lot #{item.lot_number}</p>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtDate(item.date)}</p>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>{fmt(item.total_cost)}</p>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Hammer {fmt(item.hammer_price)}</p>
                    </div>
                  </div>
                  <div style={S.cardActions}>
                    <button style={S.chipBtn} onClick={() => { setModal({ type: 'photos', data: item }); loadPhotos(item.id); }}>📷 Photos</button>
                    <button style={{ ...S.chipBtn, background: 'var(--accent-light)', color: 'var(--accent)', fontWeight: 600 }} onClick={() => setModal({ type: 'sell', data: item })}>💰 Sell</button>
                    <button style={S.chipBtn} onClick={() => handleLifecycle(item, false)}>🔄 Timeline</button>
                  </div>
                </div>
              );
            })
          }
        </div>}

        {/* ═══ SOLD ═══ */}
        {tab === 'sold' && <div>
          <div style={{ padding: '20px 0 12px' }}>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>Sold Items</h1>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{sold.length} sales · {fmt(totalRev)} revenue · <span style={{ color: totalProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>{totalProfit >= 0 ? '+' : ''}{fmt(totalProfit)} profit</span></p>
          </div>

          {sold.length === 0 ? <Empty text="No sales yet" /> :
            sold.map((si, i) => {
              const p = parseFloat(si.profit);
              return (
                <div key={si.id} className="fade-up" style={{ ...S.card, marginBottom: 10, animationDelay: `${i * 30}ms` }}>
                  <div style={S.cardRow}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: p >= 0 ? 'var(--green-light)' : 'var(--red-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 16 }}>{p >= 0 ? '📈' : '📉'}</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{si.title}</p>
                      <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{si.sold_buyer || 'Walk-in'} · {si.sold_platform || 'Direct'}</p>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtTs(si.sold_at)}</p>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <p style={{ fontSize: 16, fontWeight: 700 }}>{fmt(si.sold_price)}</p>
                      <p style={{ fontSize: 13, fontWeight: 600, color: p >= 0 ? 'var(--green)' : 'var(--red)' }}>{p >= 0 ? '+' : ''}{fmt(si.profit)}</p>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)' }}>{si.receipt_number}</p>
                    </div>
                  </div>
                  <div style={S.cardActions}>
                    <button style={S.chipBtn} onClick={() => handleReceipt(si)}>🧾 Receipt</button>
                    <button style={S.chipBtn} onClick={() => { setModal({ type: 'share', data: si }); }}>📤 Share</button>
                    <button style={S.chipBtn} onClick={() => handleLifecycle(si, true)}>🔄 Timeline</button>
                  </div>
                </div>
              );
            })
          }
        </div>}

        {/* ═══ ACCOUNT ═══ */}
        {tab === 'account' && <div>
          <div style={{ padding: '20px 0 12px' }}>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>Account</h1>
          </div>

          <div style={{ ...S.card, marginBottom: 10 }}>
            <div style={{ ...S.cardRow, justifyContent: 'space-between' }}>
              <div><p style={{ fontSize: 14, fontWeight: 600 }}>{user?.email}</p><p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Signed in</p></div>
              <button style={{ ...S.chipBtn, color: 'var(--red)' }} onClick={() => db.signOut()}>Sign Out</button>
            </div>
          </div>

          <h3 style={{ fontSize: 15, fontWeight: 600, margin: '16px 0 8px' }}>Business Info</h3>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>Appears on generated receipts</p>
          <div style={S.card}>
            <div style={{ padding: 16 }}>
              <Lbl t="Business Name" /><input style={S.input} value={biz.business_name || ''} onChange={e => setBiz({ ...biz, business_name: e.target.value })} />
              <Lbl t="Address" /><input style={S.input} value={biz.address || ''} onChange={e => setBiz({ ...biz, address: e.target.value })} />
              <Lbl t="Phone" /><input style={S.input} value={biz.phone || ''} onChange={e => setBiz({ ...biz, phone: e.target.value })} />
              <Lbl t="Email" /><input style={S.input} value={biz.email || ''} onChange={e => setBiz({ ...biz, email: e.target.value })} />
              <Lbl t="HST #" /><input style={S.input} value={biz.hst || ''} onChange={e => setBiz({ ...biz, hst: e.target.value })} />
              <button style={{ ...S.btnPrimary, width: '100%', marginTop: 14 }} onClick={async () => { await db.upsertSettings(biz); notify('success', 'Saved!'); }}>Save</button>
            </div>
          </div>

          <h3 style={{ fontSize: 15, fontWeight: 600, margin: '16px 0 8px' }}>Analytics</h3>
          <div style={S.statsGrid}>
            <div style={S.statCard}><p style={S.statLabel}>Invested</p><p style={S.statVal}>{fmt(totalSpent)}</p></div>
            <div style={S.statCard}><p style={S.statLabel}>Revenue</p><p style={S.statVal}>{fmt(totalRev)}</p></div>
            <div style={S.statCard}><p style={S.statLabel}>Customers</p><p style={S.statVal}>{customers.length}</p></div>
          </div>

          <button style={{ width: '100%', padding: 14, marginTop: 16, background: 'var(--red-light)', border: '1px solid var(--red)', borderRadius: 'var(--radius-sm)', color: 'var(--red)', fontSize: 14, fontFamily: 'var(--font)' }}
            onClick={async () => { if (!confirm('Delete all data permanently?')) return; await db.clearAllData(); await load(); notify('success', 'Cleared'); }}>
            Reset All Data
          </button>
        </div>}
      </main>

      {/* ═══ BOTTOM NAV ═══ */}
      <nav style={S.nav}>
        {TABS.map(t => <button key={t.id} onClick={() => { setTab(t.id); setSearch(''); }} style={{ ...S.navItem, color: tab === t.id ? 'var(--accent)' : 'var(--text-muted)' }}>
          <span style={{ fontSize: 20 }}>{t.icon}</span>
          <span style={{ fontSize: 10, fontWeight: tab === t.id ? 700 : 400 }}>{t.label}</span>
          {t.id === 'inventory' && items.length > 0 && <span style={S.navBadge}>{items.length}</span>}
          {t.id === 'sold' && sold.length > 0 && <span style={{ ...S.navBadge, background: 'var(--green)' }}>{sold.length}</span>}
        </button>)}
      </nav>

      {/* ═══ MODALS ═══ */}

      {/* SELL */}
      {modal?.type === 'sell' && <Overlay close={closeModal}>
        <h3 style={S.mTitle}>Sell Item</h3>
        <div style={{ padding: '8px 0 12px', borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
          <p style={{ fontSize: 15, fontWeight: 600 }}>{modal.data.title}</p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Your cost: {fmt(modal.data.total_cost)}</p>
        </div>
        <Lbl t="Sale Amount *" /><input style={S.input} type="number" step="0.01" placeholder="0.00" value={sf.amount} onChange={e => setSf({ ...sf, amount: e.target.value })} autoFocus />
        <Lbl t="Platform" /><input style={S.input} placeholder="Facebook, Kijiji, eBay..." value={sf.platform} onChange={e => setSf({ ...sf, platform: e.target.value })} />
        <Lbl t="Buyer Name" /><input style={S.input} placeholder="Customer name" value={sf.buyer} onChange={e => setSf({ ...sf, buyer: e.target.value })} />
        <Lbl t="Buyer Email" /><input style={S.input} type="email" placeholder="email" value={sf.buyerEmail} onChange={e => setSf({ ...sf, buyerEmail: e.target.value })} />
        <Lbl t="Buyer Phone" /><input style={S.input} type="tel" placeholder="+1..." value={sf.buyerPhone} onChange={e => setSf({ ...sf, buyerPhone: e.target.value })} />
        {sf.amount && (() => { const p = parseFloat(sf.amount) - parseFloat(modal.data.total_cost); return (
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: p >= 0 ? 'var(--green-light)' : 'var(--red-light)', borderRadius: 'var(--radius-xs)', marginTop: 10 }}>
            <span style={{ fontSize: 14 }}>Profit</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: p >= 0 ? 'var(--green)' : 'var(--red)' }}>{p >= 0 ? '+' : ''}{fmt(p)}</span>
          </div>);
        })()}
        <button style={{ ...S.btnPrimary, width: '100%', marginTop: 14 }} onClick={handleSell} disabled={!sf.amount}>Confirm Sale</button>
      </Overlay>}

      {/* PHOTOS */}
      {modal?.type === 'photos' && <Overlay close={closeModal}>
        <h3 style={S.mTitle}>Photos — {modal.data.title}</h3>
        <label role="button" style={{ ...S.btnPrimary, display: 'block', textAlign: 'center', marginBottom: 12 }}>
          <input type="file" accept="image/*" multiple onChange={e => handlePhoto(modal.data.id, e)} style={{ display: 'none' }} />Upload Photos
        </label>
        {(itemPhotos[modal.data.id] || []).length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {itemPhotos[modal.data.id].map((p, i) => <div key={p.id || i} style={{ aspectRatio: '1', borderRadius: 'var(--radius-xs)', overflow: 'hidden', background: 'var(--bg-surface)' }}>
              {p.url ? <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-hint)' }}>Loading...</div>}
            </div>)}
          </div>
        ) : <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 20, fontSize: 14 }}>No photos yet</p>}
      </Overlay>}

      {/* VIEW INVOICE */}
      {modal?.type === 'viewInv' && <Overlay close={closeModal}>
        <h3 style={S.mTitle}>Original Invoice</h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>{modal.data.file_name} · {modal.data.auction_house}</p>
        {!viewInvUrl ? <div style={{ textAlign: 'center', padding: 30 }}><div style={S.spinner} /></div> :
          modal.data.file_type?.includes('pdf') ? <iframe src={viewInvUrl} style={{ width: '100%', height: '55vh', borderRadius: 'var(--radius-xs)', border: '1px solid var(--border)' }} /> :
            <img src={viewInvUrl} alt="" style={{ width: '100%', borderRadius: 'var(--radius-xs)' }} />}
      </Overlay>}

      {/* RECEIPT */}
      {modal?.type === 'receipt' && <Overlay close={closeModal}>
        <h3 style={S.mTitle}>Receipt</h3>
        {receiptBusy ? <div style={{ textAlign: 'center', padding: 30 }}><div style={S.spinner} /><p style={{ color: 'var(--text-muted)', marginTop: 8, fontSize: 13 }}>Generating...</p></div> :
          <div>
            <div style={{ background: '#fff', borderRadius: 'var(--radius-xs)', maxHeight: '40vh', overflow: 'auto', marginBottom: 12, border: '1px solid var(--border)' }} dangerouslySetInnerHTML={{ __html: receiptHtml }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button style={S.btnPrimary} onClick={() => printHTML(receiptHtml)}>🖨 Print / PDF</button>
              <button style={S.btnOutline} onClick={() => { setEmailTo(modal.data.sold_buyer_email || ''); setModal({ type: 'email', data: modal.data }); }}>📧 Email</button>
              <button style={S.btnOutline} onClick={() => { const b = { name: biz.business_name, phone: biz.phone }; openWhatsApp(modal.data.sold_buyer_phone, buildReceiptText(modal.data, b)); }}>📱 WhatsApp</button>
              <button style={S.btnOutline} onClick={() => { const b = { name: biz.business_name, address: biz.address, phone: biz.phone }; navigator.clipboard?.writeText(buildReceiptText(modal.data, b)); notify('success', 'Copied!'); }}>📋 Copy</button>
            </div>
          </div>}
      </Overlay>}

      {/* SHARE */}
      {modal?.type === 'share' && <Overlay close={closeModal}>
        <h3 style={S.mTitle}>Share — {modal.data.title}</h3>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 14 }}>{modal.data.receipt_number} · {fmt(modal.data.sold_price)}</p>
        {[
          { icon: '🧾', label: 'Generate Receipt', fn: () => handleReceipt(modal.data) },
          { icon: '📧', label: 'Email', fn: () => { setEmailTo(modal.data.sold_buyer_email || ''); setModal({ type: 'email', data: modal.data }); } },
          { icon: '📱', label: 'WhatsApp', fn: () => { const b = { name: biz.business_name, phone: biz.phone }; openWhatsApp(modal.data.sold_buyer_phone, buildReceiptText(modal.data, b)); } },
          { icon: '💬', label: 'SMS', fn: () => { const b = { name: biz.business_name, phone: biz.phone }; openSMS(modal.data.sold_buyer_phone, buildReceiptText(modal.data, b)); } },
          { icon: '📋', label: 'Copy Text', fn: () => { const b = { name: biz.business_name, address: biz.address, phone: biz.phone }; navigator.clipboard?.writeText(buildReceiptText(modal.data, b)); notify('success', 'Copied!'); closeModal(); } },
        ].map((a, i) => <button key={i} style={S.menuItem} onClick={a.fn}><span style={{ fontSize: 18 }}>{a.icon}</span>{a.label}</button>)}
      </Overlay>}

      {/* EMAIL */}
      {modal?.type === 'email' && <Overlay close={closeModal}>
        <h3 style={S.mTitle}>Email Receipt</h3>
        <Lbl t="Recipient Email" /><input style={S.input} type="email" placeholder="customer@email.com" value={emailTo} onChange={e => setEmailTo(e.target.value)} autoFocus />
        <button style={{ ...S.btnPrimary, width: '100%', marginTop: 14 }} onClick={handleEmail} disabled={!emailTo}>Send Email</button>
      </Overlay>}

      {/* LIFECYCLE */}
      {modal?.type === 'lifecycle' && <Overlay close={closeModal}>
        <h3 style={S.mTitle}>Timeline — {modal.data.title}</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <NB l="Cost" v={fmt(modal.data.total_cost)} />
          <NB l="Hammer" v={fmt(modal.data.hammer_price)} />
          {modal.data.sold_price && <NB l="Sold" v={fmt(modal.data.sold_price)} />}
          {modal.data.profit && <NB l="Profit" v={`${parseFloat(modal.data.profit) >= 0 ? '+' : ''}${fmt(modal.data.profit)}`} c={parseFloat(modal.data.profit) >= 0 ? 'var(--green)' : 'var(--red)'} />}
        </div>
        <div style={{ borderLeft: '2px solid var(--border)', marginLeft: 8, paddingLeft: 16 }}>
          {lcEvents.map((ev, i) => <div key={ev.id} style={{ paddingBottom: 14, position: 'relative' }}>
            <div style={{ position: 'absolute', left: -23, top: 4, width: 8, height: 8, borderRadius: 4, background: i === lcEvents.length - 1 ? 'var(--accent)' : 'var(--border)' }} />
            <p style={{ fontSize: 14, fontWeight: 500 }}>{ev.event}</p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtTs(ev.created_at)}</p>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{ev.detail}</p>
          </div>)}
        </div>
      </Overlay>}
    </div>
  );
}

// ─── Components ───
function Overlay({ close, children }) {
  return <div style={S.overlay} onClick={close}><div className="slide-up" style={S.modal} onClick={e => e.stopPropagation()}><div style={S.handle} />{children}</div></div>;
}
function Pill({ text, ok }) { return <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: ok ? 'var(--green-light)' : 'var(--red-light)', color: ok ? 'var(--green)' : 'var(--red)' }}>{text}</span>; }
function Empty({ text }) { return <div style={{ textAlign: 'center', padding: 40 }}><p style={{ fontSize: 36, marginBottom: 4 }}>📭</p><p style={{ fontSize: 14, color: 'var(--text-muted)' }}>{text}</p></div>; }
function Lbl({ t }) { return <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', margin: '10px 0 4px' }}>{t}</label>; }
function NB({ l, v, c }) { return <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-xs)', padding: '6px 12px', flex: '1 1 70px' }}><p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{l}</p><p style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono)', color: c || 'var(--text)' }}>{v}</p></div>; }

// ─── Styles ───
const S = {
  app: { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' },
  splash: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' },
  spinner: { width: 28, height: 28, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin .8s linear infinite' },
  miniSpin: { width: 14, height: 14, border: '2px solid rgba(255,255,255,.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin .6s linear infinite', flexShrink: 0, marginRight: 8 },
  toast: { position: 'fixed', top: 12, left: 16, right: 16, padding: '12px 16px', borderRadius: 'var(--radius-sm)', color: '#fff', fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', zIndex: 200, boxShadow: '0 4px 12px rgba(0,0,0,.15)' },
  main: { flex: 1, overflow: 'auto', padding: '0 16px', paddingBottom: 'calc(64px + env(safe-area-inset-bottom, 0px))' },

  // Nav
  nav: { display: 'flex', justifyContent: 'space-around', background: 'var(--bg-card)', borderTop: '1px solid var(--border)', position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50, paddingBottom: 'env(safe-area-inset-bottom, 0px)' },
  navItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, padding: '8px 0', minWidth: 64, background: 'none', border: 'none', fontFamily: 'var(--font)', position: 'relative' },
  navBadge: { position: 'absolute', top: 2, right: 10, background: 'var(--accent)', color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 10, minWidth: 16, textAlign: 'center' },

  // Stats
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 },
  statCard: { background: 'var(--bg-card)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', boxShadow: 'var(--shadow-sm)' },
  statLabel: { fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 2 },
  statVal: { fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)' },

  // Upload
  uploadCard: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '28px 20px', background: 'var(--bg-card)', borderRadius: 'var(--radius)', border: '2px dashed var(--border)', textAlign: 'center', marginBottom: 16, cursor: 'pointer' },

  // Cards
  card: { background: 'var(--bg-card)', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' },
  cardRow: { display: 'flex', gap: 12, padding: '14px 16px', alignItems: 'center', cursor: 'pointer' },
  cardActions: { display: 'flex', gap: 6, padding: '8px 16px', borderTop: '1px solid var(--border-light)' },
  chipBtn: { padding: '6px 12px', background: 'var(--bg-surface)', border: 'none', borderRadius: 20, fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font)' },
  linkBtn: { background: 'none', border: 'none', color: 'var(--accent)', fontSize: 14, fontWeight: 500, fontFamily: 'var(--font)' },

  // Inputs
  input: { width: '100%', padding: '12px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xs)', fontSize: 15, color: 'var(--text)', fontFamily: 'var(--font)', boxSizing: 'border-box', outline: 'none' },
  btnPrimary: { padding: '14px 24px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-xs)', fontSize: 15, fontWeight: 600, fontFamily: 'var(--font)', textAlign: 'center' },
  btnOutline: { padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xs)', fontSize: 14, color: 'var(--text)', fontFamily: 'var(--font)', textAlign: 'center' },

  // Modal
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 100 },
  modal: { background: 'var(--bg-card)', borderRadius: '20px 20px 0 0', padding: '8px 20px 28px', width: '100%', maxWidth: 500, maxHeight: '88vh', overflow: 'auto' },
  handle: { width: 36, height: 4, background: 'var(--border)', borderRadius: 4, margin: '0 auto 14px' },
  mTitle: { fontSize: 18, fontWeight: 700, marginBottom: 8 },
  menuItem: { display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px 16px', background: 'var(--bg-surface)', border: 'none', borderRadius: 'var(--radius-xs)', fontSize: 15, color: 'var(--text)', fontFamily: 'var(--font)', marginBottom: 6, textAlign: 'left' },
};
