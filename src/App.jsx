import { useState, useEffect, useCallback, useRef } from 'react';
import * as db from './utils/db';
import { parseInvoiceAI, generateReceiptAI, generateBillAI, sendEmailFallback } from './utils/api';
import { uid, fmt, fmtDate, fmtTs, readFileAsBase64, openWhatsApp, openSMS, printHTML, buildReceiptText } from './utils/helpers';

const TABS = [
  { id: 'home', icon: '🏠', label: 'Home' },
  { id: 'inventory', icon: '📦', label: 'Inventory' },
  { id: 'sales', icon: '💰', label: 'Sales' },
  { id: 'account', icon: '👤', label: 'Account' },
];
const INV_FILTERS = ['All', 'For Sale', 'Personal', 'Pending', 'Listed'];
const SALE_FILTERS = ['New Bill', 'Due', 'Closed'];

export default function App() {
  const [auth, setAuth] = useState('loading');
  const [user, setUser] = useState(null);
  const [af, setAf] = useState({ email: '', password: '', mode: 'login' });
  const [authErr, setAuthErr] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  const [tab, setTab] = useState('home');
  const [invFilter, setInvFilter] = useState('All');
  const [saleFilter, setSaleFilter] = useState('New Bill');
  const [invoices, setInvoices] = useState([]);
  const [items, setItems] = useState([]);
  const [sold, setSold] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [biz, setBiz] = useState({ business_name: '', address: '', phone: '', email: '', hst: '' });
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState('');

  const [modal, setModal] = useState(null);
  const [receiptHtml, setReceiptHtml] = useState('');
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [billHtml, setBillHtml] = useState('');
  const [billBusy, setBillBusy] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [viewInvUrl, setViewInvUrl] = useState(null);
  const [invDetailItems, setInvDetailItems] = useState([]);
  const [lcEvents, setLcEvents] = useState([]);
  const [itemPhotos, setItemPhotos] = useState({});
  const [sf, setSf] = useState({ amount: '', platform: '', buyer: '', buyerEmail: '', buyerPhone: '', billStatus: 'paid' });
  const [billItems, setBillItems] = useState([]);
  const [billSearch, setBillSearch] = useState('');
  const fileRef = useRef(null);

  const notify = useCallback((t, m) => { setToast({ t, m }); setTimeout(() => setToast(null), 4000); }, []);
  const closeModal = () => { setModal(null); setReceiptHtml(''); setBillHtml(''); setViewInvUrl(null); setInvDetailItems([]); setLcEvents([]); setEmailTo(''); setBillItems([]); setBillSearch(''); setSf({ amount: '', platform: '', buyer: '', buyerEmail: '', buyerPhone: '', billStatus: 'paid' }); };

  // Auth
  useEffect(() => {
    const { data: { subscription } } = db.onAuthChange((_, s) => { if (s?.user) { setUser(s.user); setAuth('app'); } else { setUser(null); setAuth('login'); } });
    db.getUser().then(u => { if (u) { setUser(u); setAuth('app'); } else setAuth('login'); });
    return () => subscription.unsubscribe();
  }, []);
  const handleAuth = useCallback(async () => {
    setAuthBusy(true); setAuthErr('');
    try { if (af.mode === 'login') await db.signIn(af.email, af.password); else { await db.signUp(af.email, af.password); notify('ok', 'Check email to confirm!'); } } catch (e) { setAuthErr(e.message); }
    setAuthBusy(false);
  }, [af, notify]);

  const load = useCallback(async () => {
    try {
      const [inv, itm, sld, cust, s] = await Promise.all([db.getInvoices(), db.getItems(), db.getSoldItems(), db.getCustomers(), db.getSettings()]);
      setInvoices(inv); setItems(itm); setSold(sld); setCustomers(cust); if (s) setBiz(s);
    } catch (e) { console.error(e); }
  }, []);
  useEffect(() => { if (auth === 'app') load(); }, [auth, load]);

  const loadPhotos = useCallback(async (id) => { try { const p = await db.getPhotoUrls(id, null); setItemPhotos(prev => ({ ...prev, [id]: p })); } catch (e) { console.error(e); } }, []);

  // Upload Invoice
  const handleUpload = useCallback(async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    notify('info', 'Claude AI analyzing invoice...');
    try {
      const b64 = await readFileAsBase64(file);
      const result = await parseInvoiceAI(b64, file.type);
      const tempId = uid();
      const filePath = await db.uploadInvoiceFile(tempId, b64, file.name, file.type);
      const newInv = await db.insertInvoice({
        date: result.invoice.date, auction_house: result.invoice.auction_house, invoice_number: result.invoice.invoice_number,
        event_description: result.invoice.event_description, payment_method: result.invoice.payment_method,
        payment_status: result.invoice.payment_status || 'Due', pickup_location: result.invoice.pickup_location,
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
        pickup_location: result.invoice.pickup_location, payment_method: result.invoice.payment_method,
        status: 'in_inventory', purpose: 'for_sale', listing_status: 'none',
      }));
      const inserted = await db.insertItems(rows);
      const now = new Date().toISOString();
      await db.addLifecycleEvents(inserted.flatMap(it => [
        { item_id: it.id, event: 'Purchased', detail: `${result.invoice.auction_house} - ${file.name}`, created_at: now },
        { item_id: it.id, event: 'Added to Inventory', detail: `Lot #${it.lot_number} · Cost: ${fmt(it.total_cost)}`, created_at: now },
      ]));
      await load(); notify('ok', `${result.items.length} items from ${result.invoice.auction_house}`);
    } catch (err) { notify('err', err.message); }
    if (fileRef.current) fileRef.current.value = '';
  }, [notify, load]);

  // Item actions
  const setItemPurpose = useCallback(async (item, purpose) => { await db.updateItem(item.id, { purpose }); await db.addLifecycleEvent({ item_id: item.id, event: purpose === 'personal' ? 'Marked Personal' : 'Marked For Sale', detail: '' }); await load(); notify('ok', purpose === 'personal' ? 'Personal use' : 'For sale'); }, [load, notify]);
  const setListingStatus = useCallback(async (item, status, platform, price) => {
    const u = { listing_status: status }; if (platform) u.listing_platform = platform; if (price) u.listing_price = price; if (status === 'live_listed') u.listed_at = new Date().toISOString();
    await db.updateItem(item.id, u); const l = { pending_list: 'Pending List', live_listed: 'Listed Live', none: 'Unlisted' };
    await db.addLifecycleEvent({ item_id: item.id, event: l[status] || status, detail: platform ? `on ${platform}` : '' }); await load(); notify('ok', l[status]);
  }, [load, notify]);
  const handlePhoto = useCallback(async (id, e) => { const files = Array.from(e.target.files || []); if (!files.length) return; notify('info', 'Uploading...'); for (const f of files) { await db.uploadPhoto(id, f); await db.addLifecycleEvent({ item_id: id, event: 'Photo Added', detail: f.name }); } await loadPhotos(id); notify('ok', `${files.length} photo(s) saved`); }, [notify, loadPhotos]);

  // ─── SELL (single item) ───
  const handleSell = useCallback(async () => {
    const item = modal?.data; if (!item || !sf.amount) return;
    const amt = parseFloat(sf.amount); if (isNaN(amt)) return;
    const rcpt = `BOS-${Date.now().toString(36).toUpperCase()}`;
    const cost = parseFloat(item.total_cost); const profit = +(amt - cost).toFixed(2); const pct = cost > 0 ? +((profit / cost) * 100).toFixed(1) : 0;
    const si = await db.insertSoldItem({
      item_id: item.id, invoice_id: item.invoice_id, lot_number: item.lot_number, title: item.title,
      description: item.description, quantity: item.quantity, hammer_price: item.hammer_price,
      premium_rate: item.premium_rate, tax_rate: item.tax_rate, premium_amount: item.premium_amount,
      subtotal: item.subtotal, tax_amount: item.tax_amount, total_cost: item.total_cost,
      auction_house: item.auction_house, date: item.date, pickup_location: item.pickup_location,
      payment_method: item.payment_method, sold_price: amt, sold_platform: sf.platform,
      sold_buyer: sf.buyer, sold_buyer_email: sf.buyerEmail, sold_buyer_phone: sf.buyerPhone,
      receipt_number: rcpt, profit, profit_pct: pct, bill_status: sf.billStatus,
      paid_at: sf.billStatus === 'paid' ? new Date().toISOString() : null,
    });
    await db.deleteItem(item.id);
    const oldLc = await db.getLifecycle(item.id, null);
    if (oldLc.length) await db.addLifecycleEvents(oldLc.map(ev => ({ sold_item_id: si.id, event: ev.event, detail: ev.detail, created_at: ev.created_at })));
    await db.addLifecycleEvent({ sold_item_id: si.id, event: 'Sold', detail: `${fmt(amt)} · ${sf.billStatus === 'due' ? 'DUE' : 'PAID'} · ${rcpt}` });
    if (sf.buyer && !customers.find(c => c.name === sf.buyer)) await db.insertCustomer({ name: sf.buyer, email: sf.buyerEmail, phone: sf.buyerPhone });
    await load(); closeModal();

    // Auto-generate bill document
    notify('info', 'Generating Bill of Sale...');
    try {
      const seller = { name: biz.business_name, address: biz.address, phone: biz.phone, email: biz.email, hst: biz.hst };
      const buyer = { name: sf.buyer || 'Walk-in', email: sf.buyerEmail, phone: sf.buyerPhone };
      const result = await generateBillAI({ billNumber: rcpt, items: [{ title: item.title, lot_number: item.lot_number, quantity: item.quantity || 1, price: amt }], buyer, seller, billStatus: sf.billStatus, taxRate: 0.13, date: new Date().toISOString() });
      await db.updateSoldItem(si.id, { receipt_html: result.html });
      setBillHtml(result.html);
      await load();
      setModal({ type: 'billPreview', data: { ...si, receipt_html: result.html, sold_buyer: sf.buyer, sold_buyer_email: sf.buyerEmail, sold_buyer_phone: sf.buyerPhone, receipt_number: rcpt } });
      notify('ok', `Bill #${rcpt} generated`);
    } catch (err) { notify('err', `Bill created but document failed: ${err.message}`); }
  }, [modal, sf, customers, load, notify, biz]);

  // ─── BILL OF SALE (multiple items) ───
  const handleBillOfSale = useCallback(async () => {
    if (!billItems.length || !sf.buyer) return;
    const rcpt = `BOS-${Date.now().toString(36).toUpperCase()}`;
    const soldIds = [];

    for (const bi of billItems) {
      const item = items.find(i => i.id === bi.id); if (!item) continue;
      const amt = parseFloat(bi.sellPrice) || 0; const cost = parseFloat(item.total_cost);
      const profit = +(amt - cost).toFixed(2); const pct = cost > 0 ? +((profit / cost) * 100).toFixed(1) : 0;
      const si = await db.insertSoldItem({
        item_id: item.id, invoice_id: item.invoice_id, lot_number: item.lot_number, title: item.title,
        description: item.description, quantity: item.quantity, hammer_price: item.hammer_price,
        premium_rate: item.premium_rate, tax_rate: item.tax_rate, premium_amount: item.premium_amount,
        subtotal: item.subtotal, tax_amount: item.tax_amount, total_cost: item.total_cost,
        auction_house: item.auction_house, date: item.date, sold_price: amt, sold_platform: sf.platform,
        sold_buyer: sf.buyer, sold_buyer_email: sf.buyerEmail, sold_buyer_phone: sf.buyerPhone,
        receipt_number: rcpt, profit, profit_pct: pct, bill_status: sf.billStatus,
        paid_at: sf.billStatus === 'paid' ? new Date().toISOString() : null,
      });
      await db.deleteItem(item.id);
      await db.addLifecycleEvent({ sold_item_id: si.id, event: 'Bill of Sale', detail: `${fmt(amt)} · ${rcpt} · ${sf.billStatus.toUpperCase()}` });
      soldIds.push(si);
    }
    if (sf.buyer && !customers.find(c => c.name === sf.buyer)) await db.insertCustomer({ name: sf.buyer, email: sf.buyerEmail, phone: sf.buyerPhone });
    await load();

    // Auto-generate bill document
    const billItemsForDoc = billItems.map(bi => ({ title: bi.title, lot_number: bi.lot_number, quantity: bi.quantity || 1, price: parseFloat(bi.sellPrice) || 0 }));
    closeModal();
    notify('info', 'Claude AI generating Bill of Sale document...');
    setBillBusy(true);

    try {
      const seller = { name: biz.business_name, address: biz.address, phone: biz.phone, email: biz.email, hst: biz.hst };
      const buyer = { name: sf.buyer, email: sf.buyerEmail, phone: sf.buyerPhone };
      const result = await generateBillAI({ billNumber: rcpt, items: billItemsForDoc, buyer, seller, billStatus: sf.billStatus, taxRate: 0.13, date: new Date().toISOString() });

      // Save HTML to first sold item
      if (soldIds.length > 0) await db.updateSoldItem(soldIds[0].id, { receipt_html: result.html });
      for (const si of soldIds.slice(1)) await db.updateSoldItem(si.id, { receipt_html: `See Bill #${rcpt}` });

      setBillHtml(result.html);
      setBillBusy(false);
      await load();
      setModal({ type: 'billPreview', data: { receipt_number: rcpt, receipt_html: result.html, sold_buyer: sf.buyer, sold_buyer_email: sf.buyerEmail, sold_buyer_phone: sf.buyerPhone, bill_status: sf.billStatus } });
      notify('ok', `Bill #${rcpt} · ${billItemsForDoc.length} items`);
    } catch (err) { setBillBusy(false); notify('err', `Bill saved but document failed: ${err.message}`); }
  }, [billItems, sf, items, customers, load, notify, biz]);

  // View existing bill
  const viewBill = useCallback(async (si) => {
    if (si.receipt_html && si.receipt_html.length > 50 && si.receipt_html.startsWith('<')) {
      setBillHtml(si.receipt_html);
      setModal({ type: 'billPreview', data: si });
    } else {
      // Regenerate
      handleReceipt(si);
    }
  }, []);

  // Mark paid
  const markBillPaid = useCallback(async (si) => { await db.updateSoldItem(si.id, { bill_status: 'paid', paid_at: new Date().toISOString() }); await db.addLifecycleEvent({ sold_item_id: si.id, event: 'Payment Received', detail: `${fmt(si.sold_price)} from ${si.sold_buyer || 'buyer'}` }); await load(); notify('ok', 'Marked paid'); }, [load, notify]);

  // Invoice actions
  const handleViewInv = useCallback(async (inv) => { setModal({ type: 'viewInv', data: inv }); setViewInvUrl(null); if (inv.file_path) { const url = await db.getInvoiceFileUrl(inv.file_path); setViewInvUrl(url); } }, []);
  const handleInvDetails = useCallback(async (inv) => { setModal({ type: 'invDetails', data: inv }); const itms = await db.getItemsByInvoice(inv.id); setInvDetailItems(itms); }, []);
  const handleInvStatus = useCallback(async (inv, status) => { await db.updateInvoice(inv.id, { payment_status: status }); await load(); notify('ok', `Invoice → ${status}`); }, [load, notify]);

  // Receipt (legacy single-item receipt)
  const handleReceipt = useCallback(async (si) => {
    setModal({ type: 'receipt', data: si }); setReceiptBusy(true); setReceiptHtml('');
    try {
      const b = { name: biz.business_name, address: biz.address, phone: biz.phone, email: biz.email, hst: biz.hst };
      const html = await generateReceiptAI(si, b, { name: si.sold_buyer || 'Walk-in', email: si.sold_buyer_email || '', phone: si.sold_buyer_phone || '' });
      setReceiptHtml(html); await db.updateSoldItem(si.id, { receipt_html: html });
    } catch (err) { notify('err', err.message); closeModal(); }
    setReceiptBusy(false);
  }, [biz, notify]);

  const handleLC = useCallback(async (item, isSold) => { setModal({ type: 'lc', data: item }); setLcEvents(await db.getLifecycle(isSold ? null : item.id, isSold ? item.id : null)); }, []);

  // Email
  const handleEmail = useCallback(() => {
    if (!emailTo || !modal?.data) return;
    const si = modal.data;
    const b = { name: biz.business_name, address: biz.address, phone: biz.phone };
    sendEmailFallback(emailTo, `Bill #${si.receipt_number} from ${biz.business_name}`, buildReceiptText(si, b));
    db.addLifecycleEvent({ sold_item_id: si.id, event: 'Emailed', detail: emailTo });
    notify('ok', `Opening email to ${emailTo}`); closeModal();
  }, [emailTo, modal, biz, notify]);

  // Computed
  const forSaleItems = items.filter(i => (i.purpose || 'for_sale') === 'for_sale');
  const personalItems = items.filter(i => i.purpose === 'personal');
  const pendingItems = items.filter(i => i.listing_status === 'pending_list');
  const listedItems = items.filter(i => i.listing_status === 'live_listed');
  const dueBills = sold.filter(i => i.bill_status === 'due');
  const closedBills = sold.filter(i => i.bill_status === 'paid');
  const totalSpent = [...items, ...sold].reduce((s, i) => s + parseFloat(i.total_cost || 0), 0);
  const totalRev = sold.reduce((s, i) => s + parseFloat(i.sold_price || 0), 0);
  const totalProfit = sold.reduce((s, i) => s + parseFloat(i.profit || 0), 0);
  const invValue = items.reduce((s, i) => s + parseFloat(i.total_cost || 0), 0);
  const filteredInv = () => {
    let arr = items;
    if (invFilter === 'For Sale') arr = forSaleItems.filter(i => i.listing_status === 'none' || !i.listing_status);
    else if (invFilter === 'Personal') arr = personalItems;
    else if (invFilter === 'Pending') arr = pendingItems;
    else if (invFilter === 'Listed') arr = listedItems;
    if (!search) return arr;
    const t = search.toLowerCase();
    return arr.filter(i => [i.title, i.description, i.auction_house, i.lot_number].some(f => f?.toLowerCase?.().includes(t)));
  };

  // ═══ AUTH ═══
  if (auth === 'loading') return <div style={S.splash}><div style={S.spinner} /></div>;
  if (auth === 'login') return (
    <div style={S.splash}>
      <div style={S.logoBig}>⚡</div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Auction Vault</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>Track inventory & maximize profits</p>
      <div style={{ width: '100%', maxWidth: 340, padding: '0 24px' }}>
        {authErr && <p style={{ color: 'var(--red)', fontSize: 13, textAlign: 'center', marginBottom: 8 }}>{authErr}</p>}
        <input style={S.input} type="email" placeholder="Email" value={af.email} onChange={e => setAf({ ...af, email: e.target.value })} />
        <input style={{ ...S.input, marginTop: 10 }} type="password" placeholder="Password" value={af.password} onChange={e => setAf({ ...af, password: e.target.value })} onKeyDown={e => e.key === 'Enter' && handleAuth()} />
        <button style={{ ...S.btnP, width: '100%', marginTop: 16 }} onClick={handleAuth} disabled={authBusy}>{authBusy ? '...' : af.mode === 'login' ? 'Sign In' : 'Create Account'}</button>
        <button style={S.linkBtnStyle} onClick={() => setAf({ ...af, mode: af.mode === 'login' ? 'signup' : 'login' })}>{af.mode === 'login' ? "Don't have an account? Sign up" : 'Sign in instead'}</button>
      </div>
    </div>
  );

  // ═══ MAIN ═══
  return (
    <div style={S.app}>
      {toast && <div className="fade-up" style={{ ...S.toast, background: toast.t === 'ok' ? 'var(--green)' : toast.t === 'err' ? 'var(--red)' : 'var(--accent)' }}>{toast.t === 'info' && <div style={S.miniSpin} />}{toast.m}</div>}

      {/* Bill generating overlay */}
      {billBusy && <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
        <div style={S.spinner} /><p style={{ color: '#fff', marginTop: 12, fontSize: 14 }}>Generating Bill of Sale...</p>
      </div>}

      <main style={S.main}>
        {/* ═══ HOME ═══ */}
        {tab === 'home' && <div>
          <div style={S.pageHead}><p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Dashboard</p><h1 style={{ fontSize: 22, fontWeight: 700 }}>Auction Vault</h1></div>
          <div style={S.statsRow}>
            <Stat label="Stock" value={items.length} sub={fmt(invValue)} color="var(--accent)" />
            <Stat label="Revenue" value={fmt(totalRev)} sub={`${sold.length} sold`} color="var(--green)" />
            <Stat label="Profit" value={`${totalProfit >= 0 ? '+' : ''}${fmt(totalProfit)}`} sub={totalSpent > 0 ? `${((totalProfit / totalSpent) * 100).toFixed(0)}% ROI` : '—'} color={totalProfit >= 0 ? 'var(--green)' : 'var(--red)'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
            <label role="button" style={S.actionCard}><input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={handleUpload} style={{ display: 'none' }} /><span style={{ fontSize: 24 }}>📄</span><span style={{ fontSize: 13, fontWeight: 600 }}>Upload Invoice</span></label>
            <div style={S.actionCard} onClick={() => { setTab('sales'); setSaleFilter('New Bill'); setModal({ type: 'billOfSale' }); }}><span style={{ fontSize: 24 }}>🧾</span><span style={{ fontSize: 13, fontWeight: 600 }}>Bill of Sale</span></div>
          </div>

          {dueBills.length > 0 && <div style={{ ...S.card, marginBottom: 10, background: 'var(--red-light)', border: '1px solid var(--red)' }}>
            <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><p style={{ fontSize: 14, fontWeight: 600, color: 'var(--red)' }}>⚠ {dueBills.length} Unpaid Bill{dueBills.length > 1 ? 's' : ''}</p><p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{fmt(dueBills.reduce((s, i) => s + parseFloat(i.sold_price || 0), 0))} outstanding</p></div>
              <button style={{ ...S.chipBtn, background: 'var(--red)', color: '#fff' }} onClick={() => { setTab('sales'); setSaleFilter('Due'); }}>View</button>
            </div>
          </div>}

          <h2 style={{ fontSize: 16, fontWeight: 600, margin: '16px 0 8px' }}>Purchase Invoices</h2>
          {invoices.length === 0 ? <Empty text="Upload your first invoice" /> : invoices.slice(0, 8).map((inv, i) => (
            <div key={inv.id} className="fade-up" style={{ ...S.card, marginBottom: 8, animationDelay: `${i * 40}ms` }}>
              <div style={S.cardRow} onClick={() => setModal({ type: 'invoiceOptions', data: inv })}>
                <div style={{ ...S.iconBox, background: inv.payment_status === 'Paid' ? 'var(--green-light)' : 'var(--red-light)' }}><span style={{ fontSize: 18 }}>{inv.payment_status === 'Paid' ? '✅' : '⏳'}</span></div>
                <div style={{ flex: 1, minWidth: 0 }}><p style={S.cardTitle}>{inv.auction_house}</p><p style={S.cardSub}>{fmtDate(inv.date)} · {inv.item_count} items</p></div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}><p style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>{fmt(inv.grand_total)}</p><Pill text={inv.payment_status || 'Due'} ok={inv.payment_status === 'Paid'} /></div>
              </div>
            </div>
          ))}
        </div>}

        {/* ═══ INVENTORY ═══ */}
        {tab === 'inventory' && <div>
          <div style={S.pageHead}><h1 style={{ fontSize: 22, fontWeight: 700 }}>Inventory</h1><p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{items.length} items · {fmt(invValue)}</p></div>
          <div style={S.filterRow}>{INV_FILTERS.map(f => <button key={f} style={{ ...S.filterBtn, ...(invFilter === f ? S.filterAct : {}) }} onClick={() => setInvFilter(f)}>{f}{f === 'Pending' && pendingItems.length > 0 ? ` (${pendingItems.length})` : f === 'Listed' && listedItems.length > 0 ? ` (${listedItems.length})` : f === 'Personal' && personalItems.length > 0 ? ` (${personalItems.length})` : ''}</button>)}</div>
          <input style={{ ...S.input, marginBottom: 10 }} placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
          {filteredInv().length === 0 ? <Empty text="No items" /> : filteredInv().map((item, i) => {
            const photos = itemPhotos[item.id] || [];
            return (
              <div key={item.id} className="fade-up" style={{ ...S.card, marginBottom: 8, animationDelay: `${i * 25}ms` }}>
                <div style={S.cardRow}>
                  <div style={S.thumb} onClick={() => { setModal({ type: 'photos', data: item }); loadPhotos(item.id); }}>
                    {photos.length > 0 && photos[0].url ? <img src={photos[0].url} alt="" style={S.thumbImg} /> : <span style={{ fontSize: 20, color: 'var(--text-hint)' }}>📷</span>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }} onClick={() => setModal({ type: 'itemActions', data: item })}>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 2 }}>
                      {item.purpose === 'personal' && <Pill text="Personal" />}
                      {item.listing_status === 'pending_list' && <Pill text="Pending" color="var(--accent)" bg="var(--accent-light)" />}
                      {item.listing_status === 'live_listed' && <Pill text="Live" color="var(--green)" bg="var(--green-light)" />}
                    </div>
                    <p style={S.cardTitle}>{item.title}</p>
                    <p style={S.cardSub}>{item.auction_house} · Lot #{item.lot_number}</p>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}><p style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>{fmt(item.total_cost)}</p>{item.listing_price && <p style={{ fontSize: 11, color: 'var(--green)' }}>Ask {fmt(item.listing_price)}</p>}</div>
                </div>
                <div style={S.cardActions}>
                  <button style={S.chipBtn} onClick={() => { setModal({ type: 'photos', data: item }); loadPhotos(item.id); }}>📷</button>
                  <button style={S.chipBtn} onClick={() => setModal({ type: 'itemActions', data: item })}>⚙</button>
                  {item.purpose !== 'personal' && <button style={{ ...S.chipBtn, background: 'var(--accent-light)', color: 'var(--accent)', fontWeight: 600 }} onClick={() => setModal({ type: 'sell', data: item })}>💰 Sell</button>}
                  <button style={S.chipBtn} onClick={() => handleLC(item, false)}>🔄</button>
                </div>
              </div>
            );
          })}
        </div>}

        {/* ═══ SALES ═══ */}
        {tab === 'sales' && <div>
          <div style={S.pageHead}><h1 style={{ fontSize: 22, fontWeight: 700 }}>Sales</h1><p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{fmt(totalRev)} revenue · <span style={{ color: totalProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>{totalProfit >= 0 ? '+' : ''}{fmt(totalProfit)}</span></p></div>
          <div style={S.filterRow}>{SALE_FILTERS.map(f => <button key={f} style={{ ...S.filterBtn, ...(saleFilter === f ? S.filterAct : {}) }} onClick={() => setSaleFilter(f)}>{f}{f === 'Due' && dueBills.length > 0 ? ` (${dueBills.length})` : ''}</button>)}</div>

          {saleFilter === 'New Bill' && <div>
            <button style={{ ...S.btnP, width: '100%', marginBottom: 16 }} onClick={() => setModal({ type: 'billOfSale' })}>🧾 Create Bill of Sale</button>
            {sold.length > 0 && <><h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>All Sales</h3>
              {sold.map((si, i) => <SoldCard key={si.id} si={si} i={i} onBill={() => viewBill(si)} onReceipt={() => handleReceipt(si)} onShare={() => setModal({ type: 'share', data: si })} onLC={() => handleLC(si, true)} onMarkPaid={si.bill_status === 'due' ? () => markBillPaid(si) : null} />)}</>}
          </div>}

          {saleFilter === 'Due' && <div>{dueBills.length === 0 ? <Empty text="No unpaid bills" /> : dueBills.map((si, i) => <SoldCard key={si.id} si={si} i={i} onBill={() => viewBill(si)} onReceipt={() => handleReceipt(si)} onShare={() => setModal({ type: 'share', data: si })} onLC={() => handleLC(si, true)} onMarkPaid={() => markBillPaid(si)} />)}</div>}

          {saleFilter === 'Closed' && <div>{closedBills.length === 0 ? <Empty text="No closed sales" /> : <>
            <div style={{ ...S.card, marginBottom: 10, padding: '12px 16px', display: 'flex', justifyContent: 'space-around' }}>
              <div style={{ textAlign: 'center' }}><p style={{ fontSize: 10, color: 'var(--text-muted)' }}>REVENUE</p><p style={{ fontSize: 16, fontWeight: 700 }}>{fmt(closedBills.reduce((s, i) => s + parseFloat(i.sold_price || 0), 0))}</p></div>
              <div style={{ textAlign: 'center' }}><p style={{ fontSize: 10, color: 'var(--text-muted)' }}>PROFIT</p><p style={{ fontSize: 16, fontWeight: 700, color: 'var(--green)' }}>+{fmt(closedBills.reduce((s, i) => s + parseFloat(i.profit || 0), 0))}</p></div>
              <div style={{ textAlign: 'center' }}><p style={{ fontSize: 10, color: 'var(--text-muted)' }}>SALES</p><p style={{ fontSize: 16, fontWeight: 700 }}>{closedBills.length}</p></div>
            </div>
            {closedBills.map((si, i) => <SoldCard key={si.id} si={si} i={i} onBill={() => viewBill(si)} onReceipt={() => handleReceipt(si)} onShare={() => setModal({ type: 'share', data: si })} onLC={() => handleLC(si, true)} />)}
          </>}</div>}
        </div>}

        {/* ═══ ACCOUNT ═══ */}
        {tab === 'account' && <div>
          <div style={S.pageHead}><h1 style={{ fontSize: 22, fontWeight: 700 }}>Account</h1></div>
          <div style={{ ...S.card, marginBottom: 10 }}><div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><p style={{ fontSize: 14, fontWeight: 600 }}>{user?.email}</p><button style={{ ...S.chipBtn, color: 'var(--red)' }} onClick={() => db.signOut()}>Sign Out</button></div></div>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: '16px 0 8px' }}>Business Info (on bills & receipts)</h3>
          <div style={{ ...S.card, padding: 16 }}>
            <Lbl t="Business Name" /><input style={S.input} value={biz.business_name || ''} onChange={e => setBiz({ ...biz, business_name: e.target.value })} />
            <Lbl t="Address" /><input style={S.input} value={biz.address || ''} onChange={e => setBiz({ ...biz, address: e.target.value })} />
            <Lbl t="Phone" /><input style={S.input} value={biz.phone || ''} onChange={e => setBiz({ ...biz, phone: e.target.value })} />
            <Lbl t="Email" /><input style={S.input} value={biz.email || ''} onChange={e => setBiz({ ...biz, email: e.target.value })} />
            <Lbl t="HST #" /><input style={S.input} value={biz.hst || ''} onChange={e => setBiz({ ...biz, hst: e.target.value })} />
            <button style={{ ...S.btnP, width: '100%', marginTop: 12 }} onClick={async () => { await db.upsertSettings(biz); notify('ok', 'Saved!'); }}>Save</button>
          </div>
          <button style={S.dangerBtn} onClick={async () => { if (!confirm('Delete ALL data?')) return; await db.clearAllData(); await load(); notify('ok', 'Cleared'); }}>Reset All Data</button>
        </div>}
      </main>

      {/* NAV */}
      <nav style={S.nav}>{TABS.map(t => <button key={t.id} onClick={() => { setTab(t.id); setSearch(''); }} style={{ ...S.navItem, color: tab === t.id ? 'var(--accent)' : 'var(--text-muted)' }}><span style={{ fontSize: 20 }}>{t.icon}</span><span style={{ fontSize: 10, fontWeight: tab === t.id ? 700 : 400 }}>{t.label}</span>{t.id === 'inventory' && items.length > 0 && <span style={S.navBadge}>{items.length}</span>}{t.id === 'sales' && dueBills.length > 0 && <span style={{ ...S.navBadge, background: 'var(--red)' }}>{dueBills.length}</span>}</button>)}</nav>

      {/* ═══ MODALS ═══ */}

      {/* INVOICE OPTIONS */}
      {modal?.type === 'invoiceOptions' && <OL close={closeModal}>
        <h3 style={S.mT}>{modal.data.auction_house}</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>{fmtDate(modal.data.date)} · #{modal.data.invoice_number} · {fmt(modal.data.grand_total)}</p>
        <MBtn icon="📄" label="View Original Invoice Copy" onClick={() => { closeModal(); handleViewInv(modal.data); }} />
        <MBtn icon="📊" label="View Extracted Details" onClick={() => { closeModal(); handleInvDetails(modal.data); }} />
        <MBtn icon={modal.data.payment_status === 'Paid' ? '⏳' : '✅'} label={modal.data.payment_status === 'Paid' ? 'Mark as Due' : 'Mark as Paid'} onClick={() => { handleInvStatus(modal.data, modal.data.payment_status === 'Paid' ? 'Due' : 'Paid'); closeModal(); }} />
        <MBtn icon="🗑" label="Delete Invoice" color="var(--red)" onClick={() => { db.deleteItemsByInvoice(modal.data.id).then(() => db.deleteInvoice(modal.data.id)).then(load); closeModal(); notify('ok', 'Deleted'); }} />
      </OL>}

      {/* INVOICE DETAILS */}
      {modal?.type === 'invDetails' && <OL close={closeModal}>
        <h3 style={S.mT}>Invoice Details</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>{modal.data.auction_house} · {fmtDate(modal.data.date)}</p>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>#{modal.data.invoice_number} · {modal.data.item_count} items · <Pill text={modal.data.payment_status || 'Due'} ok={modal.data.payment_status === 'Paid'} /></p>
        <div style={{ ...S.card, marginBottom: 10, padding: '10px 14px', display: 'flex', justifyContent: 'space-between' }}>
          <div><p style={{ fontSize: 10, color: 'var(--text-muted)' }}>LOT TOTAL</p><p style={{ fontSize: 14, fontWeight: 600 }}>{fmt(modal.data.lot_total)}</p></div>
          <div><p style={{ fontSize: 10, color: 'var(--text-muted)' }}>PREMIUM</p><p style={{ fontSize: 14, fontWeight: 600 }}>{fmt(modal.data.premium_total)}</p></div>
          <div><p style={{ fontSize: 10, color: 'var(--text-muted)' }}>TAX</p><p style={{ fontSize: 14, fontWeight: 600 }}>{fmt(modal.data.tax_total)}</p></div>
          <div><p style={{ fontSize: 10, color: 'var(--text-muted)' }}>TOTAL</p><p style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>{fmt(modal.data.grand_total)}</p></div>
        </div>
        {invDetailItems.map(it => <div key={it.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between' }}>
          <div style={{ flex: 1, minWidth: 0 }}><p style={{ fontSize: 14, fontWeight: 500 }}>Lot #{it.lot_number} — {it.title}</p><p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{it.description?.slice(0, 80)}</p></div>
          <div style={{ textAlign: 'right', flexShrink: 0, paddingLeft: 10 }}><p style={{ fontSize: 13, fontWeight: 600 }}>{fmt(it.hammer_price)}</p><p style={{ fontSize: 10, color: 'var(--text-muted)' }}>Total: {fmt(it.total_cost)}</p></div>
        </div>)}
      </OL>}

      {/* VIEW INVOICE FILE */}
      {modal?.type === 'viewInv' && <OL close={closeModal}>
        <h3 style={S.mT}>Original Invoice</h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>{modal.data.file_name}</p>
        {!viewInvUrl ? <div style={{ textAlign: 'center', padding: 30 }}><div style={S.spinner} /></div> :
          modal.data.file_type?.includes('pdf') ? <iframe src={viewInvUrl} style={{ width: '100%', height: '55vh', borderRadius: 8, border: '1px solid var(--border)' }} /> :
            <img src={viewInvUrl} alt="" style={{ width: '100%', borderRadius: 8 }} />}
      </OL>}

      {/* ITEM ACTIONS */}
      {modal?.type === 'itemActions' && <OL close={closeModal}>
        <h3 style={S.mT}>{modal.data.title}</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>Lot #{modal.data.lot_number} · Cost: {fmt(modal.data.total_cost)}</p>
        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>PURPOSE</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button style={{ ...S.toggleBtn, ...(modal.data.purpose !== 'personal' ? S.toggleAct : {}) }} onClick={() => { setItemPurpose(modal.data, 'for_sale'); closeModal(); }}>🏷 For Sale</button>
          <button style={{ ...S.toggleBtn, ...(modal.data.purpose === 'personal' ? S.toggleAct : {}) }} onClick={() => { setItemPurpose(modal.data, 'personal'); closeModal(); }}>🏠 Personal</button>
        </div>
        {modal.data.purpose !== 'personal' && <><p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>LISTING</p>
          <MBtn icon="📋" label="Add to Pending List" onClick={() => { setListingStatus(modal.data, 'pending_list'); closeModal(); }} />
          <MBtn icon="🟢" label="Mark as Live Listed" onClick={() => setModal({ type: 'goLive', data: modal.data })} />
          {(modal.data.listing_status === 'pending_list' || modal.data.listing_status === 'live_listed') && <MBtn icon="↩" label="Remove from Listings" onClick={() => { setListingStatus(modal.data, 'none'); closeModal(); }} />}
        </>}
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 10 }}>
          <MBtn icon="💰" label="Sell This Item" onClick={() => { closeModal(); setModal({ type: 'sell', data: modal.data }); }} />
          <MBtn icon="📷" label="Photos" onClick={() => { closeModal(); setModal({ type: 'photos', data: modal.data }); loadPhotos(modal.data.id); }} />
          <MBtn icon="🔄" label="Timeline" onClick={() => { closeModal(); handleLC(modal.data, false); }} />
        </div>
      </OL>}

      {/* GO LIVE */}
      {modal?.type === 'goLive' && <OL close={closeModal}>
        <h3 style={S.mT}>List Live — {modal.data.title}</h3>
        <Lbl t="Platform" /><input style={S.input} placeholder="Facebook, Kijiji, eBay..." value={sf.platform} onChange={e => setSf({ ...sf, platform: e.target.value })} />
        <Lbl t="Asking Price" /><input style={S.input} type="number" step="0.01" placeholder="0.00" value={sf.amount} onChange={e => setSf({ ...sf, amount: e.target.value })} />
        <button style={{ ...S.btnP, width: '100%', marginTop: 14 }} onClick={() => { setListingStatus(modal.data, 'live_listed', sf.platform, parseFloat(sf.amount) || null); closeModal(); }}>🟢 Go Live</button>
      </OL>}

      {/* SELL */}
      {modal?.type === 'sell' && <OL close={closeModal}>
        <h3 style={S.mT}>Sell — {modal.data.title}</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>Cost: {fmt(modal.data.total_cost)}</p>
        <Lbl t="Amount *" /><input style={S.input} type="number" step="0.01" placeholder="0.00" value={sf.amount} onChange={e => setSf({ ...sf, amount: e.target.value })} autoFocus />
        <Lbl t="Platform" /><input style={S.input} placeholder="Facebook, Kijiji..." value={sf.platform} onChange={e => setSf({ ...sf, platform: e.target.value })} />
        <Lbl t="Buyer" /><input style={S.input} value={sf.buyer} onChange={e => setSf({ ...sf, buyer: e.target.value })} />
        <Lbl t="Buyer Email" /><input style={S.input} type="email" value={sf.buyerEmail} onChange={e => setSf({ ...sf, buyerEmail: e.target.value })} />
        <Lbl t="Buyer Phone" /><input style={S.input} type="tel" value={sf.buyerPhone} onChange={e => setSf({ ...sf, buyerPhone: e.target.value })} />
        <Lbl t="Payment" />
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button style={{ ...S.toggleBtn, ...(sf.billStatus === 'paid' ? S.toggleAct : {}) }} onClick={() => setSf({ ...sf, billStatus: 'paid' })}>✅ Paid</button>
          <button style={{ ...S.toggleBtn, ...(sf.billStatus === 'due' ? { ...S.toggleAct, background: 'var(--red-light)', color: 'var(--red)', borderColor: 'var(--red)' } : {}) }} onClick={() => setSf({ ...sf, billStatus: 'due' })}>⏳ Due</button>
        </div>
        {sf.amount && (() => { const p = parseFloat(sf.amount) - parseFloat(modal.data.total_cost); return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: p >= 0 ? 'var(--green-light)' : 'var(--red-light)', borderRadius: 8, marginTop: 6 }}><span>Profit</span><span style={{ fontWeight: 700, color: p >= 0 ? 'var(--green)' : 'var(--red)' }}>{p >= 0 ? '+' : ''}{fmt(p)}</span></div>; })()}
        <button style={{ ...S.btnP, width: '100%', marginTop: 14 }} onClick={handleSell} disabled={!sf.amount}>Confirm Sale & Generate Bill</button>
      </OL>}

      {/* BILL OF SALE (multi-item) */}
      {modal?.type === 'billOfSale' && <OL close={closeModal}>
        <h3 style={S.mT}>Create Bill of Sale</h3>
        <Lbl t="Search & Add Items" />
        <input style={S.input} placeholder="Search inventory..." value={billSearch} onChange={e => setBillSearch(e.target.value)} />
        {billSearch && <div style={{ maxHeight: 150, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginTop: 4, marginBottom: 8 }}>
          {items.filter(i => i.purpose !== 'personal' && !billItems.find(b => b.id === i.id) && [i.title, i.lot_number].some(f => f?.toLowerCase().includes(billSearch.toLowerCase()))).map(i =>
            <div key={i.id} style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-light)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }} onClick={() => { setBillItems(p => [...p, { ...i, sellPrice: '' }]); setBillSearch(''); }}>
              <span style={{ fontSize: 13 }}>{i.title}</span><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmt(i.total_cost)}</span>
            </div>)}
        </div>}
        {billItems.length > 0 && <div style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Items ({billItems.length})</p>
          {billItems.map((bi, idx) => <div key={bi.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border-light)' }}>
            <div style={{ flex: 1, minWidth: 0 }}><p style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bi.title}</p><p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Cost: {fmt(bi.total_cost)}</p></div>
            <input style={{ ...S.input, width: 90, padding: '6px 8px', fontSize: 14, textAlign: 'right' }} type="number" step="0.01" placeholder="Price" value={bi.sellPrice} onChange={e => { const v = e.target.value; setBillItems(p => p.map((b, i) => i === idx ? { ...b, sellPrice: v } : b)); }} />
            <button style={{ background: 'none', border: 'none', color: 'var(--red)', fontSize: 16, padding: 4 }} onClick={() => setBillItems(p => p.filter((_, i) => i !== idx))}>✕</button>
          </div>)}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', fontWeight: 600, fontSize: 15 }}>
            <span>Total</span><span style={{ color: 'var(--accent)' }}>{fmt(billItems.reduce((s, i) => s + (parseFloat(i.sellPrice) || 0), 0))}</span>
          </div>
        </div>}
        <Lbl t="Buyer Name *" /><input style={S.input} value={sf.buyer} onChange={e => setSf({ ...sf, buyer: e.target.value })} />
        <Lbl t="Buyer Email" /><input style={S.input} type="email" value={sf.buyerEmail} onChange={e => setSf({ ...sf, buyerEmail: e.target.value })} />
        <Lbl t="Buyer Phone" /><input style={S.input} type="tel" value={sf.buyerPhone} onChange={e => setSf({ ...sf, buyerPhone: e.target.value })} />
        <Lbl t="Payment" />
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button style={{ ...S.toggleBtn, ...(sf.billStatus === 'paid' ? S.toggleAct : {}) }} onClick={() => setSf({ ...sf, billStatus: 'paid' })}>✅ Paid</button>
          <button style={{ ...S.toggleBtn, ...(sf.billStatus === 'due' ? { ...S.toggleAct, background: 'var(--red-light)', color: 'var(--red)', borderColor: 'var(--red)' } : {}) }} onClick={() => setSf({ ...sf, billStatus: 'due' })}>⏳ Due</button>
        </div>
        <button style={{ ...S.btnP, width: '100%', marginTop: 10 }} onClick={handleBillOfSale} disabled={!billItems.length || !sf.buyer || billItems.some(b => !b.sellPrice)}>Generate Bill of Sale</button>
      </OL>}

      {/* ═══ BILL PREVIEW ═══ */}
      {modal?.type === 'billPreview' && <OL close={closeModal}>
        <h3 style={S.mT}>Bill of Sale — {modal.data.receipt_number}</h3>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <Pill text={modal.data.bill_status === 'due' ? 'Payment Due' : 'Paid'} ok={modal.data.bill_status !== 'due'} />
        </div>
        <div style={{ background: '#fff', borderRadius: 8, maxHeight: '40vh', overflow: 'auto', marginBottom: 12, border: '1px solid var(--border)' }} dangerouslySetInnerHTML={{ __html: billHtml || modal.data.receipt_html }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button style={S.btnP} onClick={() => printHTML(billHtml || modal.data.receipt_html)}>🖨 Print / PDF</button>
          <button style={S.btnO} onClick={() => { setEmailTo(modal.data.sold_buyer_email || ''); setModal({ type: 'email', data: modal.data }); }}>📧 Email</button>
          <button style={S.btnO} onClick={() => { const b = { name: biz.business_name, phone: biz.phone }; openWhatsApp(modal.data.sold_buyer_phone, `Bill of Sale #${modal.data.receipt_number}\n${buildReceiptText(modal.data, b)}`); }}>📱 WhatsApp</button>
          <button style={S.btnO} onClick={() => { const b = { name: biz.business_name, address: biz.address, phone: biz.phone }; navigator.clipboard?.writeText(`Bill of Sale #${modal.data.receipt_number}\n${buildReceiptText(modal.data, b)}`); notify('ok', 'Copied!'); }}>📋 Copy</button>
        </div>
        {modal.data.bill_status === 'due' && <button style={{ ...S.btnP, width: '100%', marginTop: 10, background: 'var(--green)' }} onClick={() => { markBillPaid(modal.data); closeModal(); }}>✅ Mark as Paid</button>}
      </OL>}

      {/* PHOTOS */}
      {modal?.type === 'photos' && <OL close={closeModal}>
        <h3 style={S.mT}>Photos</h3>
        <label role="button" style={{ ...S.btnP, display: 'block', textAlign: 'center', marginBottom: 12 }}><input type="file" accept="image/*" multiple onChange={e => handlePhoto(modal.data.id, e)} style={{ display: 'none' }} />Upload Photos</label>
        {(itemPhotos[modal.data.id] || []).length > 0 ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>{(itemPhotos[modal.data.id]).map((p, i) => <div key={p.id || i} style={{ aspectRatio: '1', borderRadius: 8, overflow: 'hidden', background: 'var(--bg-surface)' }}>{p.url ? <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--text-hint)' }}>...</div>}</div>)}</div> : <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 16 }}>No photos yet</p>}
      </OL>}

      {/* RECEIPT (legacy) */}
      {modal?.type === 'receipt' && <OL close={closeModal}>
        <h3 style={S.mT}>Receipt</h3>
        {receiptBusy ? <div style={{ textAlign: 'center', padding: 30 }}><div style={S.spinner} /><p style={{ color: 'var(--text-muted)', marginTop: 8 }}>Generating...</p></div> : <div>
          <div style={{ background: '#fff', borderRadius: 8, maxHeight: '40vh', overflow: 'auto', marginBottom: 10, border: '1px solid var(--border)' }} dangerouslySetInnerHTML={{ __html: receiptHtml }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <button style={S.btnP} onClick={() => printHTML(receiptHtml)}>🖨 Print</button>
            <button style={S.btnO} onClick={() => { setEmailTo(modal.data.sold_buyer_email || ''); setModal({ type: 'email', data: modal.data }); }}>📧 Email</button>
          </div>
        </div>}
      </OL>}

      {/* SHARE */}
      {modal?.type === 'share' && <OL close={closeModal}>
        <h3 style={S.mT}>Share — {modal.data.title}</h3>
        <MBtn icon="🧾" label="View/Generate Bill" onClick={() => { closeModal(); viewBill(modal.data); }} />
        <MBtn icon="📧" label="Email" onClick={() => { setEmailTo(modal.data.sold_buyer_email || ''); setModal({ type: 'email', data: modal.data }); }} />
        <MBtn icon="📱" label="WhatsApp" onClick={() => { const b = { name: biz.business_name, phone: biz.phone }; openWhatsApp(modal.data.sold_buyer_phone, buildReceiptText(modal.data, b)); }} />
        <MBtn icon="💬" label="SMS" onClick={() => { const b = { name: biz.business_name, phone: biz.phone }; openSMS(modal.data.sold_buyer_phone, buildReceiptText(modal.data, b)); }} />
        <MBtn icon="📋" label="Copy" onClick={() => { const b = { name: biz.business_name, address: biz.address, phone: biz.phone }; navigator.clipboard?.writeText(buildReceiptText(modal.data, b)); notify('ok', 'Copied!'); closeModal(); }} />
      </OL>}

      {/* EMAIL */}
      {modal?.type === 'email' && <OL close={closeModal}>
        <h3 style={S.mT}>Email</h3><Lbl t="To" /><input style={S.input} type="email" placeholder="email" value={emailTo} onChange={e => setEmailTo(e.target.value)} autoFocus />
        <button style={{ ...S.btnP, width: '100%', marginTop: 14 }} onClick={handleEmail} disabled={!emailTo}>Send</button>
      </OL>}

      {/* LIFECYCLE */}
      {modal?.type === 'lc' && <OL close={closeModal}>
        <h3 style={S.mT}>Timeline — {modal.data.title}</h3>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <NB l="Cost" v={fmt(modal.data.total_cost)} />
          {modal.data.sold_price && <NB l="Sold" v={fmt(modal.data.sold_price)} />}
          {modal.data.profit && <NB l="Profit" v={`${parseFloat(modal.data.profit) >= 0 ? '+' : ''}${fmt(modal.data.profit)}`} c={parseFloat(modal.data.profit) >= 0 ? 'var(--green)' : 'var(--red)'} />}
        </div>
        <div style={{ borderLeft: '2px solid var(--border)', marginLeft: 6, paddingLeft: 14 }}>
          {lcEvents.map((ev, i) => <div key={ev.id} style={{ paddingBottom: 12, position: 'relative' }}>
            <div style={{ position: 'absolute', left: -21, top: 4, width: 8, height: 8, borderRadius: 4, background: i === lcEvents.length - 1 ? 'var(--accent)' : 'var(--border)' }} />
            <p style={{ fontSize: 14, fontWeight: 500 }}>{ev.event}</p><p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtTs(ev.created_at)}</p><p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{ev.detail}</p>
          </div>)}
        </div>
      </OL>}
    </div>
  );
}

// ─── Components ───
function OL({ close, children }) { return <div style={S.overlay} onClick={close}><div className="slide-up" style={S.modal} onClick={e => e.stopPropagation()}><div style={S.handle} />{children}</div></div>; }
function Pill({ text, ok, color, bg }) { return <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: bg || (ok ? 'var(--green-light)' : 'var(--red-light)'), color: color || (ok ? 'var(--green)' : 'var(--red)') }}>{text}</span>; }
function Empty({ text }) { return <div style={{ textAlign: 'center', padding: 36 }}><p style={{ fontSize: 32 }}>📭</p><p style={{ fontSize: 14, color: 'var(--text-muted)' }}>{text}</p></div>; }
function Lbl({ t }) { return <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', margin: '10px 0 3px' }}>{t}</label>; }
function NB({ l, v, c }) { return <div style={{ background: 'var(--bg-surface)', borderRadius: 8, padding: '6px 12px', flex: '1 1 70px' }}><p style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{l}</p><p style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: c || 'var(--text)' }}>{v}</p></div>; }
function MBtn({ icon, label, onClick, color }) { return <button style={{ ...S.menuItem, color: color || 'var(--text)' }} onClick={onClick}><span style={{ fontSize: 18 }}>{icon}</span>{label}</button>; }
function Stat({ label, value, sub, color }) { return <div style={{ ...S.statCard, borderLeft: `3px solid ${color}` }}><p style={S.statLabel}>{label}</p><p style={{ ...S.statVal, color }}>{value}</p><p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{sub}</p></div>; }
function SoldCard({ si, i, onBill, onReceipt, onShare, onLC, onMarkPaid }) {
  const p = parseFloat(si.profit);
  return (
    <div className="fade-up" style={{ ...S.card, marginBottom: 8, animationDelay: `${i * 25}ms` }}>
      <div style={S.cardRow}>
        <div style={{ ...S.iconBox, background: si.bill_status === 'due' ? 'var(--red-light)' : 'var(--green-light)' }}><span style={{ fontSize: 16 }}>{si.bill_status === 'due' ? '⏳' : '✅'}</span></div>
        <div style={{ flex: 1, minWidth: 0 }}><p style={S.cardTitle}>{si.title}</p><p style={S.cardSub}>{si.sold_buyer || 'Walk-in'} · {si.sold_platform || 'Direct'} · {fmtTs(si.sold_at)}</p><p style={{ fontSize: 10, color: 'var(--text-muted)' }}>{si.receipt_number}</p></div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}><p style={{ fontSize: 15, fontWeight: 700 }}>{fmt(si.sold_price)}</p><p style={{ fontSize: 12, fontWeight: 600, color: p >= 0 ? 'var(--green)' : 'var(--red)' }}>{p >= 0 ? '+' : ''}{fmt(si.profit)}</p><Pill text={si.bill_status === 'due' ? 'Due' : 'Paid'} ok={si.bill_status !== 'due'} /></div>
      </div>
      <div style={S.cardActions}>
        {onMarkPaid && <button style={{ ...S.chipBtn, background: 'var(--green-light)', color: 'var(--green)', fontWeight: 600 }} onClick={onMarkPaid}>✅ Paid</button>}
        <button style={{ ...S.chipBtn, background: 'var(--accent-light)', color: 'var(--accent)', fontWeight: 600 }} onClick={onBill}>🧾 Bill</button>
        <button style={S.chipBtn} onClick={onShare}>📤</button>
        <button style={S.chipBtn} onClick={onLC}>🔄</button>
      </div>
    </div>
  );
}

const S = {
  app: { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' },
  splash: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' },
  logoBig: { width: 56, height: 56, borderRadius: 16, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, filter: 'brightness(10)', marginBottom: 16 },
  spinner: { width: 28, height: 28, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin .8s linear infinite' },
  miniSpin: { width: 14, height: 14, border: '2px solid rgba(255,255,255,.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin .6s linear infinite', flexShrink: 0, marginRight: 8 },
  toast: { position: 'fixed', top: 12, left: 16, right: 16, padding: '12px 16px', borderRadius: 12, color: '#fff', fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', zIndex: 200, boxShadow: '0 4px 12px rgba(0,0,0,.15)' },
  main: { flex: 1, overflow: 'auto', padding: '0 16px', paddingBottom: 'calc(64px + env(safe-area-inset-bottom, 0px))' },
  pageHead: { padding: '16px 0 10px' },
  nav: { display: 'flex', justifyContent: 'space-around', background: 'var(--bg-card)', borderTop: '1px solid var(--border)', position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50, paddingBottom: 'env(safe-area-inset-bottom, 0px)' },
  navItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, padding: '8px 0', minWidth: 64, background: 'none', border: 'none', fontFamily: 'var(--font)', position: 'relative' },
  navBadge: { position: 'absolute', top: 2, right: 10, background: 'var(--accent)', color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 10, minWidth: 16, textAlign: 'center' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 },
  statCard: { background: 'var(--bg-card)', borderRadius: 12, padding: '10px 12px', boxShadow: 'var(--shadow-sm)' },
  statLabel: { fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 2 },
  statVal: { fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)' },
  actionCard: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '20px 12px', background: 'var(--bg-card)', borderRadius: 12, border: '2px dashed var(--border)', cursor: 'pointer', textAlign: 'center' },
  filterRow: { display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 10, paddingBottom: 2 },
  filterBtn: { padding: '7px 14px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--bg-card)', fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontFamily: 'var(--font)', cursor: 'pointer' },
  filterAct: { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)', fontWeight: 600 },
  card: { background: 'var(--bg-card)', borderRadius: 12, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' },
  cardRow: { display: 'flex', gap: 12, padding: '12px 16px', alignItems: 'center', cursor: 'pointer' },
  cardTitle: { fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cardSub: { fontSize: 12, color: 'var(--text-secondary)' },
  cardActions: { display: 'flex', gap: 6, padding: '8px 16px', borderTop: '1px solid var(--border-light)' },
  iconBox: { width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  thumb: { width: 52, height: 52, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
  thumbImg: { width: '100%', height: '100%', objectFit: 'cover' },
  chipBtn: { padding: '6px 12px', background: 'var(--bg-surface)', border: 'none', borderRadius: 20, fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font)', cursor: 'pointer' },
  input: { width: '100%', padding: '12px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 15, color: 'var(--text)', fontFamily: 'var(--font)', boxSizing: 'border-box', outline: 'none' },
  btnP: { padding: '14px 24px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600, fontFamily: 'var(--font)', textAlign: 'center', cursor: 'pointer' },
  btnO: { padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 14, color: 'var(--text)', fontFamily: 'var(--font)', textAlign: 'center', cursor: 'pointer' },
  linkBtnStyle: { background: 'none', border: 'none', color: 'var(--accent)', fontSize: 13, marginTop: 12, width: '100%', textAlign: 'center', fontFamily: 'var(--font)', cursor: 'pointer' },
  dangerBtn: { width: '100%', padding: 14, marginTop: 16, background: 'var(--red-light)', border: '1px solid var(--red)', borderRadius: 10, color: 'var(--red)', fontSize: 14, fontFamily: 'var(--font)', cursor: 'pointer' },
  toggleBtn: { flex: 1, padding: '10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface)', fontSize: 14, fontFamily: 'var(--font)', textAlign: 'center', cursor: 'pointer', color: 'var(--text-secondary)' },
  toggleAct: { background: 'var(--accent-light)', color: 'var(--accent)', borderColor: 'var(--accent)', fontWeight: 600 },
  menuItem: { display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px 16px', background: 'var(--bg-surface)', border: 'none', borderRadius: 8, fontSize: 15, fontFamily: 'var(--font)', marginBottom: 6, textAlign: 'left', cursor: 'pointer' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 100 },
  modal: { background: 'var(--bg-card)', borderRadius: '20px 20px 0 0', padding: '8px 20px 28px', width: '100%', maxWidth: 500, maxHeight: '88vh', overflow: 'auto' },
  handle: { width: 36, height: 4, background: 'var(--border)', borderRadius: 4, margin: '0 auto 14px' },
  mT: { fontSize: 18, fontWeight: 700, marginBottom: 6 },
};
