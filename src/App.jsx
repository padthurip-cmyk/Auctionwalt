import { useState, useEffect, useCallback, useRef } from 'react';
import * as db from './utils/db';
import { parseInvoiceAI, generateReceiptAI, generateBillAI, extractListing, sendEmailFallback } from './utils/api';
import { uid, fmt, fmtDate, fmtTs, readFileAsBase64, openWhatsApp, openSMS, printHTML, buildReceiptText } from './utils/helpers';

const TABS = [
  { id: 'home', icon: '🏠', label: 'Home' },
  { id: 'inventory', icon: '📦', label: 'Stock' },
  { id: 'sales', icon: '💰', label: 'Sales' },
  { id: 'issues', icon: '⚠️', label: 'Issues' },
  { id: 'account', icon: '👤', label: 'Me' },
];
const INV_FILTERS = ['All', 'For Sale', 'Personal', 'Pending', 'Listed'];
const SALE_FILTERS = ['New Bill', 'Due', 'Closed'];
const ISSUE_FILTERS = ['Open', 'Resolved', 'All'];

const NOTE_CATEGORIES = [
  { id: 'product_defect', label: 'Product Defect', icon: '🔴', color: 'var(--red)', bg: 'var(--red-light)' },
  { id: 'missing_parts', label: 'Missing Parts', icon: '🟡', color: '#B45309', bg: '#FEF3C7' },
  { id: 'customer_hold', label: 'Customer Hold', icon: '🔵', color: 'var(--blue)', bg: 'var(--blue-light)' },
  { id: 'return_request', label: 'Return Request', icon: '🟠', color: '#C2410C', bg: '#FFF7ED' },
  { id: 'damaged', label: 'Damaged / Broken', icon: '⛔', color: 'var(--red)', bg: 'var(--red-light)' },
  { id: 'shipping_issue', label: 'Shipping Issue', icon: '📦', color: '#7C3AED', bg: '#F5F3FF' },
  { id: 'price_dispute', label: 'Price Dispute', icon: '💲', color: '#B45309', bg: '#FEF3C7' },
  { id: 'warranty', label: 'Warranty Claim', icon: '🛡', color: 'var(--blue)', bg: 'var(--blue-light)' },
  { id: 'follow_up', label: 'Follow Up Needed', icon: '📌', color: '#C2410C', bg: '#FFF7ED' },
  { id: 'general', label: 'General Note', icon: '📝', color: 'var(--text-secondary)', bg: 'var(--bg-surface)' },
];

const getCat = (id) => NOTE_CATEGORIES.find(c => c.id === id) || NOTE_CATEGORIES[NOTE_CATEGORIES.length - 1];

export default function App() {
  const [auth, setAuth] = useState('loading');
  const [user, setUser] = useState(null);
  const [af, setAf] = useState({ email: '', password: '', mode: 'login' });
  const [authErr, setAuthErr] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [tab, setTab] = useState('home');
  const [invFilter, setInvFilter] = useState('All');
  const [saleFilter, setSaleFilter] = useState('New Bill');
  const [issueFilter, setIssueFilter] = useState('Open');
  const [invoices, setInvoices] = useState([]);
  const [items, setItems] = useState([]);
  const [sold, setSold] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [allNotes, setAllNotes] = useState([]);
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
  const [invDetailTab, setInvDetailTab] = useState('items');
  const [lcEvents, setLcEvents] = useState([]);
  const [itemPhotos, setItemPhotos] = useState({});
  const [itemNotes, setItemNotes] = useState([]);
  const [sf, setSf] = useState({ amount: '', platform: '', buyer: '', buyerEmail: '', buyerPhone: '', billStatus: 'paid', includeHst: true, listingUrl: '' });
  const [extractBusy, setExtractBusy] = useState(false);
  const [extractData, setExtractData] = useState(null);
  const [noteForm, setNoteForm] = useState({ category: 'product_defect', note: '' });
  const [billItems, setBillItems] = useState([]);
  const [billSearch, setBillSearch] = useState('');
  const fileRef = useRef(null);

  const notify = useCallback((t, m) => { setToast({ t, m }); setTimeout(() => setToast(null), 4000); }, []);
  const closeModal = () => { setModal(null); setReceiptHtml(''); setBillHtml(''); setViewInvUrl(null); setInvDetailItems([]); setInvDetailTab('items'); setLcEvents([]); setEmailTo(''); setBillItems([]); setBillSearch(''); setItemNotes([]); setNoteForm({ category: 'product_defect', note: '' }); setSf({ amount: '', platform: '', buyer: '', buyerEmail: '', buyerPhone: '', billStatus: 'paid', includeHst: true, listingUrl: '' }); setExtractBusy(false); setExtractData(null); };

  // Auth
  useEffect(() => {
    const { data: { subscription } } = db.onAuthChange((_, s) => { if (s?.user) { setUser(s.user); setAuth('app'); } else { setUser(null); setAuth('login'); } });
    db.getUser().then(u => { if (u) { setUser(u); setAuth('app'); } else setAuth('login'); });
    return () => subscription.unsubscribe();
  }, []);
  const handleAuth = useCallback(async () => {
    setAuthBusy(true); setAuthErr('');
    try { if (af.mode === 'login') await db.signIn(af.email, af.password); else { await db.signUp(af.email, af.password); notify('ok', 'Check email!'); } } catch (e) { setAuthErr(e.message); }
    setAuthBusy(false);
  }, [af, notify]);

  // Load all
  const load = useCallback(async () => {
    try {
      const [inv, itm, sld, cust, s, notes, thumbs] = await Promise.all([db.getInvoices(), db.getItems(), db.getSoldItems(), db.getCustomers(), db.getSettings(), db.getAllNotes(), db.getAllThumbnails()]);
      setInvoices(inv); setItems(itm); setSold(sld); setCustomers(cust); setAllNotes(notes); if (s) setBiz(s);
      // Merge thumbnails without overwriting full photo lists already loaded
      setItemPhotos(prev => {
        const merged = { ...prev };
        for (const [id, photos] of Object.entries(thumbs)) {
          if (!merged[id] || merged[id].length <= 1) merged[id] = photos;
        }
        return merged;
      });
    } catch (e) { console.error(e); }
  }, []);
  useEffect(() => { if (auth === 'app') load(); }, [auth, load]);

  const loadPhotos = useCallback(async (id) => { try { const p = await db.getPhotoUrls(id, null); setItemPhotos(prev => ({ ...prev, [id]: p })); } catch (e) {} }, []);
  const loadItemNotes = useCallback(async (itemId, soldItemId) => { try { const n = await db.getNotes(itemId, soldItemId); setItemNotes(n); } catch (e) {} }, []);

  // Upload
  const handleUpload = useCallback(async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    notify('info', 'Claude AI analyzing...');
    try {
      const b64 = await readFileAsBase64(file);
      const result = await parseInvoiceAI(b64, file.type);
      const tempId = uid();
      const filePath = await db.uploadInvoiceFile(tempId, b64, file.name, file.type);
      const newInv = await db.insertInvoice({ date: result.invoice.date, auction_house: result.invoice.auction_house, invoice_number: result.invoice.invoice_number, event_description: result.invoice.event_description, payment_method: result.invoice.payment_method, payment_status: result.invoice.payment_status || 'Due', pickup_location: result.invoice.pickup_location, buyer_premium_rate: result.invoice.buyer_premium_rate, tax_rate: result.invoice.tax_rate, lot_total: result.invoice.lot_total, premium_total: result.invoice.premium_total, tax_total: result.invoice.tax_total, grand_total: result.invoice.grand_total, file_name: file.name, file_type: file.type, file_path: filePath, item_count: result.items.length });
      const pr = result.invoice.buyer_premium_rate || 0, tr = result.invoice.tax_rate || 0.13;
      const rows = result.items.map(it => ({ invoice_id: newInv.id, lot_number: it.lot_number, title: it.title, description: it.description, quantity: it.quantity || 1, hammer_price: it.hammer_price, premium_rate: pr, tax_rate: tr, premium_amount: +(it.hammer_price * pr).toFixed(2), subtotal: +(it.hammer_price * (1 + pr)).toFixed(2), tax_amount: +(it.hammer_price * (1 + pr) * tr).toFixed(2), total_cost: +(it.hammer_price * (1 + pr) * (1 + tr)).toFixed(2), auction_house: result.invoice.auction_house, date: result.invoice.date, pickup_location: result.invoice.pickup_location, payment_method: result.invoice.payment_method, status: 'in_inventory', purpose: 'for_sale', listing_status: 'none' }));
      const inserted = await db.insertItems(rows);
      const now = new Date().toISOString();
      await db.addLifecycleEvents(inserted.flatMap(it => [{ item_id: it.id, event: 'Purchased', detail: `${result.invoice.auction_house}`, created_at: now }, { item_id: it.id, event: 'In Inventory', detail: `Lot #${it.lot_number} · ${fmt(it.total_cost)}`, created_at: now }]));
      await load(); notify('ok', `${result.items.length} items from ${result.invoice.auction_house}`);
    } catch (err) { notify('err', err.message); }
    if (fileRef.current) fileRef.current.value = '';
  }, [notify, load]);

  // Invoice
  const openInvoice = useCallback(async (inv) => { setModal({ type: 'invoiceView', data: inv }); setInvDetailTab('items'); setViewInvUrl(null); setInvDetailItems(await db.getItemsByInvoice(inv.id)); if (inv.file_path) setViewInvUrl(await db.getInvoiceFileUrl(inv.file_path)); }, []);
  const handleInvStatus = useCallback(async (inv, st) => { await db.updateInvoice(inv.id, { payment_status: st }); await load(); notify('ok', `→ ${st}`); }, [load, notify]);

  // Item actions
  const setItemPurpose = useCallback(async (item, p) => { await db.updateItem(item.id, { purpose: p }); await db.addLifecycleEvent({ item_id: item.id, event: p === 'personal' ? 'Personal' : 'For Sale' }); await load(); notify('ok', p === 'personal' ? 'Personal' : 'For sale'); }, [load, notify]);
  const setListingStatus = useCallback(async (item, st, platform, price) => { const u = { listing_status: st }; if (platform) u.listing_platform = platform; if (price) u.listing_price = price; if (st === 'live_listed') u.listed_at = new Date().toISOString(); await db.updateItem(item.id, u); await db.addLifecycleEvent({ item_id: item.id, event: st === 'live_listed' ? 'Listed Live' : st === 'pending_list' ? 'Pending List' : 'Unlisted', detail: platform || '' }); await load(); notify('ok', st === 'live_listed' ? 'Listed' : st === 'pending_list' ? 'Pending' : 'Unlisted'); }, [load, notify]);
  const handlePhoto = useCallback(async (id, e) => {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    // Show instant blob previews
    const previews = files.map(f => ({ id: 'temp_' + Date.now() + Math.random(), url: URL.createObjectURL(f), file_name: f.name }));
    setItemPhotos(prev => ({ ...prev, [id]: [...(prev[id] || []), ...previews] }));
    // Upload all files to Supabase
    for (const f of files) {
      try { await db.uploadPhoto(id, f); } catch (err) { console.error('Upload error:', err); }
    }
    // Reload real signed URLs (replaces blob previews)
    await loadPhotos(id);
    notify('ok', `${files.length} photo(s) saved`);
  }, [notify, loadPhotos]);
  const handleDeletePhoto = useCallback(async (itemId, photo) => { if (!confirm('Delete photo?')) return; await db.deletePhoto(photo.id, photo.file_path); await loadPhotos(itemId); notify('ok', 'Deleted'); }, [loadPhotos, notify]);

  // ─── Notes ───
  const addNote = useCallback(async (itemId, soldItemId) => {
    if (!noteForm.note.trim()) return;
    await db.insertNote({ item_id: itemId || null, sold_item_id: soldItemId || null, category: noteForm.category, note: noteForm.note.trim() });
    await db.addLifecycleEvent({ item_id: itemId || undefined, sold_item_id: soldItemId || undefined, event: 'Note Added', detail: `${getCat(noteForm.category).label}: ${noteForm.note.trim().slice(0, 50)}` });
    setNoteForm({ category: 'product_defect', note: '' });
    if (itemId) await loadItemNotes(itemId, null);
    if (soldItemId) await loadItemNotes(null, soldItemId);
    await load(); notify('ok', 'Note added');
  }, [noteForm, load, notify, loadItemNotes]);

  const resolveNote = useCallback(async (noteId, itemId, soldItemId) => {
    await db.resolveNote(noteId);
    if (itemId) await loadItemNotes(itemId, null);
    if (soldItemId) await loadItemNotes(null, soldItemId);
    await load(); notify('ok', 'Resolved');
  }, [load, notify, loadItemNotes]);

  const deleteNoteById = useCallback(async (noteId, itemId, soldItemId) => {
    if (!confirm('Delete this note?')) return;
    await db.deleteNote(noteId);
    if (itemId) await loadItemNotes(itemId, null);
    if (soldItemId) await loadItemNotes(null, soldItemId);
    await load(); notify('ok', 'Deleted');
  }, [load, notify, loadItemNotes]);

  // ─── Sell ───
  const handleSell = useCallback(async () => {
    const item = modal?.data; if (!item || !sf.amount) return;
    const amt = parseFloat(sf.amount); if (isNaN(amt)) return;
    const rcpt = `BOS-${Date.now().toString(36).toUpperCase()}`;
    const cost = parseFloat(item.total_cost); const profit = +(amt - cost).toFixed(2); const pct = cost > 0 ? +((profit / cost) * 100).toFixed(1) : 0;
    const lsf = { ...sf };
    const si = await db.insertSoldItem({ item_id: item.id, invoice_id: item.invoice_id, lot_number: item.lot_number, title: item.title, description: item.description, quantity: item.quantity, hammer_price: item.hammer_price, premium_rate: item.premium_rate, tax_rate: item.tax_rate, premium_amount: item.premium_amount, subtotal: item.subtotal, tax_amount: item.tax_amount, total_cost: item.total_cost, auction_house: item.auction_house, date: item.date, pickup_location: item.pickup_location, payment_method: item.payment_method, sold_price: amt, sold_platform: lsf.platform, sold_buyer: lsf.buyer, sold_buyer_email: lsf.buyerEmail, sold_buyer_phone: lsf.buyerPhone, receipt_number: rcpt, profit, profit_pct: pct, bill_status: lsf.billStatus, paid_at: lsf.billStatus === 'paid' ? new Date().toISOString() : null });
    await db.deleteItem(item.id);
    const oldLc = await db.getLifecycle(item.id, null);
    if (oldLc.length) await db.addLifecycleEvents(oldLc.map(ev => ({ sold_item_id: si.id, event: ev.event, detail: ev.detail, created_at: ev.created_at })));
    await db.addLifecycleEvent({ sold_item_id: si.id, event: 'Sold', detail: `${fmt(amt)} · ${lsf.billStatus === 'due' ? 'DUE' : 'PAID'} · ${rcpt}` });
    if (lsf.buyer && !customers.find(c => c.name === lsf.buyer)) await db.insertCustomer({ name: lsf.buyer, email: lsf.buyerEmail, phone: lsf.buyerPhone });
    await load(); closeModal();
    notify('info', 'Generating Bill...');
    try {
      const seller = { name: biz.business_name, address: biz.address, phone: biz.phone, email: biz.email, hst: biz.hst };
      const result = await generateBillAI({ billNumber: rcpt, items: [{ title: item.title, lot_number: item.lot_number, quantity: item.quantity || 1, price: amt }], buyer: { name: lsf.buyer || 'Walk-in', email: lsf.buyerEmail, phone: lsf.buyerPhone }, seller, billStatus: lsf.billStatus, taxRate: lsf.includeHst ? 0.13 : 0, date: new Date().toISOString() });
      await db.updateSoldItem(si.id, { receipt_html: result.html }); setBillHtml(result.html); await load();
      setModal({ type: 'billPreview', data: { ...si, receipt_html: result.html, sold_buyer: lsf.buyer, sold_buyer_email: lsf.buyerEmail, sold_buyer_phone: lsf.buyerPhone, receipt_number: rcpt, bill_status: lsf.billStatus } });
      notify('ok', `Bill #${rcpt}`);
    } catch (err) { notify('err', err.message); }
  }, [modal, sf, customers, load, notify, biz]);

  // Multi-item bill
  const handleBillOfSale = useCallback(async () => {
    if (!billItems.length || !sf.buyer) return;
    const rcpt = `BOS-${Date.now().toString(36).toUpperCase()}`;
    const lsf = { ...sf }; const lbi = [...billItems]; const soldIds = [];
    for (const bi of lbi) {
      const item = items.find(i => i.id === bi.id); if (!item) continue;
      const amt = parseFloat(bi.sellPrice) || 0; const cost = parseFloat(item.total_cost); const profit = +(amt - cost).toFixed(2); const pct = cost > 0 ? +((profit / cost) * 100).toFixed(1) : 0;
      const si = await db.insertSoldItem({ item_id: item.id, invoice_id: item.invoice_id, lot_number: item.lot_number, title: item.title, description: item.description, quantity: item.quantity, hammer_price: item.hammer_price, premium_rate: item.premium_rate, tax_rate: item.tax_rate, premium_amount: item.premium_amount, subtotal: item.subtotal, tax_amount: item.tax_amount, total_cost: item.total_cost, auction_house: item.auction_house, date: item.date, sold_price: amt, sold_platform: lsf.platform, sold_buyer: lsf.buyer, sold_buyer_email: lsf.buyerEmail, sold_buyer_phone: lsf.buyerPhone, receipt_number: rcpt, profit, profit_pct: pct, bill_status: lsf.billStatus, paid_at: lsf.billStatus === 'paid' ? new Date().toISOString() : null });
      await db.deleteItem(item.id); await db.addLifecycleEvent({ sold_item_id: si.id, event: 'Bill of Sale', detail: `${fmt(amt)} · ${rcpt}` }); soldIds.push(si);
    }
    if (lsf.buyer && !customers.find(c => c.name === lsf.buyer)) await db.insertCustomer({ name: lsf.buyer, email: lsf.buyerEmail, phone: lsf.buyerPhone });
    await load(); closeModal(); notify('info', 'Generating Bill...'); setBillBusy(true);
    try {
      const result = await generateBillAI({ billNumber: rcpt, items: lbi.map(bi => ({ title: bi.title, lot_number: bi.lot_number, quantity: bi.quantity || 1, price: parseFloat(bi.sellPrice) || 0 })), buyer: { name: lsf.buyer, email: lsf.buyerEmail, phone: lsf.buyerPhone }, seller: { name: biz.business_name, address: biz.address, phone: biz.phone, email: biz.email, hst: biz.hst }, billStatus: lsf.billStatus, taxRate: lsf.includeHst ? 0.13 : 0, date: new Date().toISOString() });
      if (soldIds[0]) await db.updateSoldItem(soldIds[0].id, { receipt_html: result.html });
      setBillHtml(result.html); setBillBusy(false); await load();
      setModal({ type: 'billPreview', data: { receipt_number: rcpt, receipt_html: result.html, sold_buyer: lsf.buyer, sold_buyer_email: lsf.buyerEmail, sold_buyer_phone: lsf.buyerPhone, bill_status: lsf.billStatus, sold_price: lbi.reduce((s, i) => s + (parseFloat(i.sellPrice) || 0), 0) } });
      notify('ok', `Bill #${rcpt} · ${lbi.length} items`);
    } catch (err) { setBillBusy(false); notify('err', err.message); }
  }, [billItems, sf, items, customers, load, notify, biz]);

  const viewBill = useCallback(async (si) => {
    if (si.receipt_html && si.receipt_html.length > 50 && si.receipt_html.startsWith('<')) { setBillHtml(si.receipt_html); setModal({ type: 'billPreview', data: si }); }
    else { setModal({ type: 'receipt', data: si }); setReceiptBusy(true); setReceiptHtml(''); try { const html = await generateReceiptAI(si, { name: biz.business_name, address: biz.address, phone: biz.phone, email: biz.email, hst: biz.hst }, { name: si.sold_buyer || 'Walk-in', email: si.sold_buyer_email || '', phone: si.sold_buyer_phone || '' }); setReceiptHtml(html); await db.updateSoldItem(si.id, { receipt_html: html }); } catch (err) { notify('err', err.message); closeModal(); } setReceiptBusy(false); }
  }, [biz, notify]);

  const markBillPaid = useCallback(async (si) => { await db.updateSoldItem(si.id, { bill_status: 'paid', paid_at: new Date().toISOString() }); await db.addLifecycleEvent({ sold_item_id: si.id, event: 'Paid', detail: fmt(si.sold_price) }); await load(); notify('ok', 'Paid'); }, [load, notify]);

  // Edit sold item
  const openEditSold = useCallback((si) => {
    setSf({ amount: String(si.sold_price || ''), platform: si.sold_platform || '', buyer: si.sold_buyer || '', buyerEmail: si.sold_buyer_email || '', buyerPhone: si.sold_buyer_phone || '', billStatus: si.bill_status || 'paid', includeHst: true, listingUrl: '' });
    setModal({ type: 'editSold', data: si });
  }, []);

  const handleEditSold = useCallback(async () => {
    const si = modal?.data; if (!si) return;
    const amt = parseFloat(sf.amount); if (isNaN(amt)) return;
    const cost = parseFloat(si.total_cost); const profit = +(amt - cost).toFixed(2); const pct = cost > 0 ? +((profit / cost) * 100).toFixed(1) : 0;
    await db.updateSoldItem(si.id, { sold_price: amt, sold_platform: sf.platform, sold_buyer: sf.buyer, sold_buyer_email: sf.buyerEmail, sold_buyer_phone: sf.buyerPhone, bill_status: sf.billStatus, profit, profit_pct: pct, paid_at: sf.billStatus === 'paid' ? (si.paid_at || new Date().toISOString()) : null });
    await db.addLifecycleEvent({ sold_item_id: si.id, event: 'Sale Edited', detail: `Price: ${fmt(amt)} · ${sf.billStatus.toUpperCase()}` });
    await load(); closeModal(); notify('ok', 'Sale updated');
  }, [modal, sf, load, notify]);

  // Return sold item back to inventory
  const returnToInventory = useCallback(async (si) => {
    if (!confirm(`Move "${si.title}" back to inventory? This will remove the sale record.`)) return;
    // Re-insert as inventory item
    const newItem = await db.insertItems([{
      invoice_id: si.invoice_id, lot_number: si.lot_number, title: si.title, description: si.description,
      quantity: si.quantity, hammer_price: si.hammer_price, premium_rate: si.premium_rate, tax_rate: si.tax_rate,
      premium_amount: si.premium_amount, subtotal: si.subtotal, tax_amount: si.tax_amount, total_cost: si.total_cost,
      auction_house: si.auction_house, date: si.date, pickup_location: si.pickup_location,
      payment_method: si.payment_method, status: 'in_inventory', purpose: 'for_sale', listing_status: 'none',
    }]);
    // Copy lifecycle from sold to new item
    const oldLc = await db.getLifecycle(null, si.id);
    if (oldLc.length && newItem[0]) await db.addLifecycleEvents(oldLc.map(ev => ({ item_id: newItem[0].id, event: ev.event, detail: ev.detail, created_at: ev.created_at })));
    if (newItem[0]) await db.addLifecycleEvent({ item_id: newItem[0].id, event: 'Returned to Inventory', detail: `Was sold for ${fmt(si.sold_price)} to ${si.sold_buyer || 'buyer'} · ${si.receipt_number}` });
    // Delete sold record — use supabase directly since we don't have a deleteSoldItem helper
    const { supabase } = await import('./utils/supabase');
    await supabase.from('sold_items').delete().eq('id', si.id);
    await load(); notify('ok', `"${si.title}" returned to inventory`);
  }, [load, notify]);
  const handleLC = useCallback(async (item, isSold) => { setModal({ type: 'lc', data: item }); setLcEvents(await db.getLifecycle(isSold ? null : item.id, isSold ? item.id : null)); }, []);
  const handleEmail = useCallback(() => { if (!emailTo || !modal?.data) return; const b = { name: biz.business_name, address: biz.address, phone: biz.phone }; sendEmailFallback(emailTo, `Bill #${modal.data.receipt_number}`, buildReceiptText(modal.data, b)); notify('ok', 'Opening email'); closeModal(); }, [emailTo, modal, biz, notify]);

  // Computed
  const personalItems = items.filter(i => i.purpose === 'personal');
  const pendingItems = items.filter(i => i.listing_status === 'pending_list');
  const listedItems = items.filter(i => i.listing_status === 'live_listed');
  const dueBills = sold.filter(i => i.bill_status === 'due');
  const closedBills = sold.filter(i => i.bill_status === 'paid');
  const openNotes = allNotes.filter(n => !n.is_resolved);
  const resolvedNotes = allNotes.filter(n => n.is_resolved);
  const totalSpent = [...items, ...sold].reduce((s, i) => s + parseFloat(i.total_cost || 0), 0);
  const totalRev = sold.reduce((s, i) => s + parseFloat(i.sold_price || 0), 0);
  const totalProfit = sold.reduce((s, i) => s + parseFloat(i.profit || 0), 0);
  const invValue = items.reduce((s, i) => s + parseFloat(i.total_cost || 0), 0);
  const filteredInv = () => { let arr = items; if (invFilter === 'For Sale') arr = items.filter(i => (i.purpose || 'for_sale') === 'for_sale' && (!i.listing_status || i.listing_status === 'none')); else if (invFilter === 'Personal') arr = personalItems; else if (invFilter === 'Pending') arr = pendingItems; else if (invFilter === 'Listed') arr = listedItems; if (!search) return arr; const t = search.toLowerCase(); return arr.filter(i => [i.title, i.description, i.auction_house, i.lot_number].some(f => f?.toLowerCase?.().includes(t))); };

  // Helper: find item/sold name for a note
  const noteItemName = (note) => {
    if (note.item_id) { const it = items.find(i => i.id === note.item_id); return it ? it.title : 'Unknown item'; }
    if (note.sold_item_id) { const si = sold.find(i => i.id === note.sold_item_id); return si ? `${si.title} (sold)` : 'Sold item'; }
    return 'Unknown';
  };

  // ═══ AUTH ═══
  if (auth === 'loading') return <div style={S.splash}><div style={S.spinner} /></div>;
  if (auth === 'login') return (
    <div style={S.splash}><div style={S.logoBig}>⚡</div><h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Auction Vault</h1><p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>Track inventory & maximize profits</p>
      <div style={{ width: '100%', maxWidth: 340, padding: '0 24px' }}>
        {authErr && <p style={{ color: 'var(--red)', fontSize: 13, textAlign: 'center', marginBottom: 8 }}>{authErr}</p>}
        <input style={S.input} type="email" placeholder="Email" value={af.email} onChange={e => setAf({ ...af, email: e.target.value })} />
        <input style={{ ...S.input, marginTop: 10 }} type="password" placeholder="Password" value={af.password} onChange={e => setAf({ ...af, password: e.target.value })} onKeyDown={e => e.key === 'Enter' && handleAuth()} />
        <button style={{ ...S.btnP, width: '100%', marginTop: 16 }} onClick={handleAuth} disabled={authBusy}>{authBusy ? '...' : af.mode === 'login' ? 'Sign In' : 'Create Account'}</button>
        <button style={S.linkS} onClick={() => setAf({ ...af, mode: af.mode === 'login' ? 'signup' : 'login' })}>{af.mode === 'login' ? "Sign up" : 'Sign in'}</button>
      </div>
    </div>
  );

  // ═══ MAIN ═══
  return (
    <div style={S.app}>
      {toast && <div className="fade-up" style={{ ...S.toast, background: toast.t === 'ok' ? 'var(--green)' : toast.t === 'err' ? 'var(--red)' : 'var(--accent)' }}>{toast.t === 'info' && <div style={S.miniSpin} />}{toast.m}</div>}
      {billBusy && <div style={S.fullOL}><div style={S.spinner} /><p style={{ color: '#fff', marginTop: 12 }}>Generating Bill...</p></div>}

      <main style={S.main}>
        {/* ═══ HOME ═══ */}
        {tab === 'home' && <div>
          <div style={S.ph}><p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Dashboard</p><h1 style={{ fontSize: 22, fontWeight: 700 }}>Auction Vault</h1></div>
          <div style={S.sRow}>
            <Stat label="Stock" value={items.length} sub={fmt(invValue)} color="var(--accent)" />
            <Stat label="Revenue" value={fmt(totalRev)} sub={`${sold.length} sold`} color="var(--green)" />
            <Stat label="Profit" value={`${totalProfit >= 0 ? '+' : ''}${fmt(totalProfit)}`} sub={totalSpent > 0 ? `${((totalProfit / totalSpent) * 100).toFixed(0)}% ROI` : '—'} color={totalProfit >= 0 ? 'var(--green)' : 'var(--red)'} />
          </div>
          {/* Detailed breakdown */}
          {items.length > 0 && <div style={{...S.sumBar, marginBottom: 14}}>
            <div style={S.sumItem}><span style={S.sumL}>For Sale</span><span style={S.sumV}>{items.filter(i=>(i.purpose||'for_sale')==='for_sale').length} · {fmt(items.filter(i=>(i.purpose||'for_sale')==='for_sale').reduce((s,i)=>s+parseFloat(i.total_cost||0),0))}</span></div>
            {personalItems.length > 0 && <div style={S.sumItem}><span style={S.sumL}>Personal</span><span style={S.sumV}>{personalItems.length} · {fmt(personalItems.reduce((s,i)=>s+parseFloat(i.total_cost||0),0))}</span></div>}
            {listedItems.length > 0 && <div style={S.sumItem}><span style={S.sumL}>Listed</span><span style={{...S.sumV,color:'var(--green)'}}>{listedItems.length} · {fmt(listedItems.reduce((s,i)=>s+parseFloat(i.listing_price||i.total_cost||0),0))}</span></div>}
            {pendingItems.length > 0 && <div style={S.sumItem}><span style={S.sumL}>Pending</span><span style={S.sumV}>{pendingItems.length}</span></div>}
            {dueBills.length > 0 && <div style={S.sumItem}><span style={S.sumL}>Due</span><span style={{...S.sumV,color:'var(--red)'}}>{dueBills.length} · {fmt(dueBills.reduce((s,i)=>s+parseFloat(i.sold_price||0),0))}</span></div>}
            {openNotes.length > 0 && <div style={S.sumItem}><span style={S.sumL}>Issues</span><span style={{...S.sumV,color:'#B45309'}}>{openNotes.length}</span></div>}
          </div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
            <label role="button" style={S.actC}><input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={handleUpload} style={{ display: 'none' }} /><span style={{ fontSize: 24 }}>📄</span><span style={{ fontSize: 13, fontWeight: 600 }}>Upload Invoice</span></label>
            <div style={S.actC} onClick={() => { setTab('sales'); setSaleFilter('New Bill'); setModal({ type: 'billOfSale' }); }}><span style={{ fontSize: 24 }}>🧾</span><span style={{ fontSize: 13, fontWeight: 600 }}>Bill of Sale</span></div>
          </div>
          {/* Alerts */}
          {openNotes.length > 0 && <div style={{ ...S.card, marginBottom: 8, background: '#FEF3C7', border: '1px solid #F59E0B' }}><div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div><p style={{ fontSize: 14, fontWeight: 600, color: '#92400E' }}>⚠️ {openNotes.length} Open Issue{openNotes.length > 1 ? 's' : ''}</p><p style={{ fontSize: 12, color: '#78350F' }}>Items need attention</p></div><button style={{ ...S.chip, background: '#F59E0B', color: '#fff' }} onClick={() => setTab('issues')}>View</button></div></div>}
          {dueBills.length > 0 && <div style={{ ...S.card, marginBottom: 8, background: 'var(--red-light)', border: '1px solid var(--red)' }}><div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div><p style={{ fontSize: 14, fontWeight: 600, color: 'var(--red)' }}>💸 {dueBills.length} Unpaid Bill{dueBills.length > 1 ? 's' : ''}</p><p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{fmt(dueBills.reduce((s, i) => s + parseFloat(i.sold_price || 0), 0))}</p></div><button style={{ ...S.chip, background: 'var(--red)', color: '#fff' }} onClick={() => { setTab('sales'); setSaleFilter('Due'); }}>View</button></div></div>}
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: '12px 0 8px' }}>Invoices</h2>
          {invoices.length === 0 ? <Empty text="Upload your first invoice" /> : invoices.slice(0, 8).map((inv, i) => <div key={inv.id} className="fade-up" style={{ ...S.card, marginBottom: 8, animationDelay: `${i * 40}ms` }}><div style={S.row} onClick={() => openInvoice(inv)}><div style={{ ...S.iBox, background: inv.payment_status === 'Paid' ? 'var(--green-light)' : 'var(--red-light)' }}><span style={{ fontSize: 18 }}>{inv.payment_status === 'Paid' ? '✅' : '⏳'}</span></div><div style={{ flex: 1, minWidth: 0 }}><p style={S.cT}>{inv.auction_house}</p><p style={S.cS}>{fmtDate(inv.date)} · {inv.item_count} items</p></div><div style={{ textAlign: 'right', flexShrink: 0 }}><p style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>{fmt(inv.grand_total)}</p><Pill text={inv.payment_status || 'Due'} ok={inv.payment_status === 'Paid'} /></div></div></div>)}
        </div>}

        {/* ═══ INVENTORY ═══ */}
        {tab === 'inventory' && <div>
          <div style={S.ph}><h1 style={{ fontSize: 22, fontWeight: 700 }}>Inventory</h1><p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{items.length} items · {fmt(invValue)}</p></div>
          <div style={S.fRow}>{INV_FILTERS.map(f => <button key={f} style={{ ...S.fBtn, ...(invFilter === f ? S.fAct : {}) }} onClick={() => setInvFilter(f)}>{f}</button>)}</div>
          {/* Summary bar for current filter */}
          {(() => { const fi = filteredInv(); const tv = fi.reduce((s,i) => s + parseFloat(i.total_cost||0), 0); const hv = fi.reduce((s,i) => s + parseFloat(i.hammer_price||0), 0); return fi.length > 0 && <div style={S.sumBar}><div style={S.sumItem}><span style={S.sumL}>{fi.length} items</span></div><div style={S.sumItem}><span style={S.sumL}>Hammer</span><span style={S.sumV}>{fmt(hv)}</span></div><div style={S.sumItem}><span style={S.sumL}>Total Cost</span><span style={{...S.sumV,color:'var(--accent)'}}>{fmt(tv)}</span></div></div>; })()}
          <input style={{ ...S.input, marginBottom: 10 }} placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
          {filteredInv().length === 0 ? <Empty text="No items" /> : filteredInv().map((item, i) => {
            const photos = itemPhotos[item.id] || [];
            const noteCount = allNotes.filter(n => n.item_id === item.id && !n.is_resolved).length;
            return <div key={item.id} className="fade-up" style={{ ...S.card, marginBottom: 8, animationDelay: `${i * 25}ms`, ...(noteCount > 0 ? { borderLeft: '3px solid #F59E0B' } : {}) }}>
              <div style={S.row}>
                <div style={S.thumb} onClick={() => { setModal({ type: 'photos', data: item }); loadPhotos(item.id); }}>{photos.length > 0 && photos[0].url ? <img src={photos[0].url} alt="" style={S.tI} /> : <span style={{ fontSize: 20, color: 'var(--text-hint)' }}>📷</span>}</div>
                <div style={{ flex: 1, minWidth: 0 }} onClick={() => setModal({ type: 'itemActions', data: item })}>
                  <div style={{ display: 'flex', gap: 4, marginBottom: 2, flexWrap: 'wrap' }}>
                    {item.purpose === 'personal' && <Pill text="Personal" />}
                    {item.listing_status === 'pending_list' && <Pill text="Pending" color="var(--accent)" bg="var(--accent-light)" />}
                    {item.listing_status === 'live_listed' && <Pill text="Live" color="var(--green)" bg="var(--green-light)" />}
                    {noteCount > 0 && <Pill text={`${noteCount} issue${noteCount > 1 ? 's' : ''}`} color="#92400E" bg="#FEF3C7" />}
                  </div>
                  <p style={S.cT}>{item.title}</p><p style={S.cS}>{item.auction_house} · Lot #{item.lot_number}</p>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}><p style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>{fmt(item.total_cost)}</p>{item.listing_price && <p style={{ fontSize: 11, color: 'var(--green)' }}>Ask {fmt(item.listing_price)}</p>}{item.listing_url && <a href={item.listing_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: 10, color: 'var(--blue)', textDecoration: 'none', display: 'block', marginTop: 2 }}>🔗 View Listing</a>}</div>
              </div>
              <div style={S.acts}>
                <button style={S.chip} onClick={() => { setModal({ type: 'photos', data: item }); loadPhotos(item.id); }}>📷</button>
                <button style={S.chip} onClick={() => { setModal({ type: 'notes', data: item, isSold: false }); loadItemNotes(item.id, null); }}>💬{noteCount > 0 ? ` ${noteCount}` : ''}</button>
                <button style={S.chip} onClick={() => setModal({ type: 'itemActions', data: item })}>⚙</button>
                {item.purpose !== 'personal' && <button style={{ ...S.chip, background: 'var(--accent-light)', color: 'var(--accent)', fontWeight: 600 }} onClick={() => setModal({ type: 'sell', data: item })}>💰 Sell</button>}
              </div>
            </div>;
          })}
        </div>}

        {/* ═══ SALES ═══ */}
        {tab === 'sales' && <div>
          <div style={S.ph}><h1 style={{ fontSize: 22, fontWeight: 700 }}>Sales</h1><p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{fmt(totalRev)} revenue · <span style={{ color: totalProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>{totalProfit >= 0 ? '+' : ''}{fmt(totalProfit)}</span></p></div>
          <div style={S.fRow}>{SALE_FILTERS.map(f => <button key={f} style={{ ...S.fBtn, ...(saleFilter === f ? S.fAct : {}) }} onClick={() => setSaleFilter(f)}>{f}{f === 'Due' && dueBills.length ? ` (${dueBills.length})` : ''}</button>)}</div>
          {saleFilter === 'New Bill' && <div><button style={{ ...S.btnP, width: '100%', marginBottom: 12 }} onClick={() => setModal({ type: 'billOfSale' })}>🧾 Create Bill of Sale</button>{sold.length > 0 && <div style={S.sumBar}><div style={S.sumItem}><span style={S.sumL}>{sold.length} sales</span></div><div style={S.sumItem}><span style={S.sumL}>Cost</span><span style={S.sumV}>{fmt(sold.reduce((s,i)=>s+parseFloat(i.total_cost||0),0))}</span></div><div style={S.sumItem}><span style={S.sumL}>Revenue</span><span style={S.sumV}>{fmt(totalRev)}</span></div><div style={S.sumItem}><span style={S.sumL}>Profit</span><span style={{...S.sumV,color:totalProfit>=0?'var(--green)':'var(--red)'}}>{totalProfit>=0?'+':''}{fmt(totalProfit)}</span></div></div>}{sold.map((si, i) => <SC key={si.id} si={si} i={i} onBill={() => viewBill(si)} onShare={() => setModal({ type: 'share', data: si })} onLC={() => handleLC(si, true)} onNote={() => { setModal({ type: 'notes', data: si, isSold: true }); loadItemNotes(null, si.id); }} onMarkPaid={si.bill_status === 'due' ? () => markBillPaid(si) : null} onEdit={() => openEditSold(si)} onReturn={() => returnToInventory(si)} noteCount={allNotes.filter(n => n.sold_item_id === si.id && !n.is_resolved).length} />)}</div>}
          {saleFilter === 'Due' && <div>{dueBills.length === 0 ? <Empty text="No unpaid" /> : <>{(() => { const dueTotal = dueBills.reduce((s,i)=>s+parseFloat(i.sold_price||0),0); const dueCost = dueBills.reduce((s,i)=>s+parseFloat(i.total_cost||0),0); return <div style={{...S.sumBar, borderLeft:'3px solid var(--red)'}}><div style={S.sumItem}><span style={S.sumL}>{dueBills.length} unpaid</span></div><div style={S.sumItem}><span style={S.sumL}>Outstanding</span><span style={{...S.sumV,color:'var(--red)'}}>{fmt(dueTotal)}</span></div><div style={S.sumItem}><span style={S.sumL}>Your Cost</span><span style={S.sumV}>{fmt(dueCost)}</span></div></div>; })()}{dueBills.map((si, i) => <SC key={si.id} si={si} i={i} onBill={() => viewBill(si)} onShare={() => setModal({ type: 'share', data: si })} onLC={() => handleLC(si, true)} onNote={() => { setModal({ type: 'notes', data: si, isSold: true }); loadItemNotes(null, si.id); }} onMarkPaid={() => markBillPaid(si)} onEdit={() => openEditSold(si)} onReturn={() => returnToInventory(si)} noteCount={allNotes.filter(n => n.sold_item_id === si.id && !n.is_resolved).length} />)}</>}</div>}
          {saleFilter === 'Closed' && <div>{closedBills.length === 0 ? <Empty text="No closed" /> : <>{(() => { const cRev = closedBills.reduce((s,i)=>s+parseFloat(i.sold_price||0),0); const cCost = closedBills.reduce((s,i)=>s+parseFloat(i.total_cost||0),0); const cProfit = closedBills.reduce((s,i)=>s+parseFloat(i.profit||0),0); return <div style={{...S.sumBar, borderLeft:'3px solid var(--green)'}}><div style={S.sumItem}><span style={S.sumL}>{closedBills.length} closed</span></div><div style={S.sumItem}><span style={S.sumL}>Cost</span><span style={S.sumV}>{fmt(cCost)}</span></div><div style={S.sumItem}><span style={S.sumL}>Revenue</span><span style={S.sumV}>{fmt(cRev)}</span></div><div style={S.sumItem}><span style={S.sumL}>Profit</span><span style={{...S.sumV,color:'var(--green)'}}>+{fmt(cProfit)}</span></div></div>; })()}{closedBills.map((si, i) => <SC key={si.id} si={si} i={i} onBill={() => viewBill(si)} onShare={() => setModal({ type: 'share', data: si })} onLC={() => handleLC(si, true)} onNote={() => { setModal({ type: 'notes', data: si, isSold: true }); loadItemNotes(null, si.id); }} onEdit={() => openEditSold(si)} onReturn={() => returnToInventory(si)} noteCount={allNotes.filter(n => n.sold_item_id === si.id && !n.is_resolved).length} />)}</>}</div>}
        </div>}

        {/* ═══ ISSUES DASHBOARD ═══ */}
        {tab === 'issues' && <div>
          <div style={S.ph}><h1 style={{ fontSize: 22, fontWeight: 700 }}>Issues & Notes</h1><p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{openNotes.length} open · {resolvedNotes.length} resolved</p></div>

          <div style={S.fRow}>{ISSUE_FILTERS.map(f => <button key={f} style={{ ...S.fBtn, ...(issueFilter === f ? S.fAct : {}) }} onClick={() => setIssueFilter(f)}>{f}{f === 'Open' && openNotes.length ? ` (${openNotes.length})` : ''}</button>)}</div>

          {/* Issues value summary */}
          {(() => {
            const notes = issueFilter === 'Open' ? openNotes : issueFilter === 'Resolved' ? resolvedNotes : allNotes;
            if (notes.length === 0) return null;
            const affectedItemIds = [...new Set(notes.map(n => n.item_id).filter(Boolean))];
            const affectedSoldIds = [...new Set(notes.map(n => n.sold_item_id).filter(Boolean))];
            const invVal = affectedItemIds.reduce((s, id) => { const it = items.find(i => i.id === id); return s + parseFloat(it?.total_cost || 0); }, 0);
            const soldVal = affectedSoldIds.reduce((s, id) => { const si = sold.find(i => i.id === id); return s + parseFloat(si?.sold_price || 0); }, 0);
            return <div style={{...S.sumBar, borderLeft:'3px solid #F59E0B', marginBottom: 10}}>
              <div style={S.sumItem}><span style={S.sumL}>{notes.length} notes</span></div>
              <div style={S.sumItem}><span style={S.sumL}>Items affected</span><span style={S.sumV}>{affectedItemIds.length + affectedSoldIds.length}</span></div>
              {invVal > 0 && <div style={S.sumItem}><span style={S.sumL}>Inventory at risk</span><span style={{...S.sumV, color:'#B45309'}}>{fmt(invVal)}</span></div>}
              {soldVal > 0 && <div style={S.sumItem}><span style={S.sumL}>Sold value</span><span style={S.sumV}>{fmt(soldVal)}</span></div>}
            </div>;
          })()}

          {/* Category summary (open only) */}
          {issueFilter === 'Open' && openNotes.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {NOTE_CATEGORIES.map(cat => {
              const count = openNotes.filter(n => n.category === cat.id).length;
              if (count === 0) return null;
              return <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 20, background: cat.bg, fontSize: 12, fontWeight: 600, color: cat.color }}>
                <span>{cat.icon}</span> {count}
              </div>;
            })}
          </div>}

          {(() => {
            const notes = issueFilter === 'Open' ? openNotes : issueFilter === 'Resolved' ? resolvedNotes : allNotes;
            if (notes.length === 0) return <Empty text={issueFilter === 'Open' ? 'No open issues — all clear!' : 'No notes'} />;
            return notes.map((note, i) => {
              const cat = getCat(note.category);
              return <div key={note.id} className="fade-up" style={{ ...S.card, marginBottom: 8, animationDelay: `${i * 25}ms`, borderLeft: `3px solid ${cat.color}`, opacity: note.is_resolved ? 0.6 : 1 }}>
                <div style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 16 }}>{cat.icon}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: cat.color, padding: '2px 8px', borderRadius: 6, background: cat.bg }}>{cat.label}</span>
                    </div>
                    {note.is_resolved && <Pill text="Resolved" color="var(--green)" bg="var(--green-light)" />}
                  </div>
                  <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{noteItemName(note)}</p>
                  <p style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.4, marginBottom: 4 }}>{note.note}</p>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtTs(note.created_at)}{note.resolved_at ? ` · Resolved ${fmtTs(note.resolved_at)}` : ''}</p>
                </div>
                {!note.is_resolved && <div style={S.acts}>
                  <button style={{ ...S.chip, background: 'var(--green-light)', color: 'var(--green)', fontWeight: 600 }} onClick={() => resolveNote(note.id, note.item_id, note.sold_item_id)}>✅ Resolve</button>
                  <button style={{ ...S.chip, color: 'var(--red)' }} onClick={() => deleteNoteById(note.id, note.item_id, note.sold_item_id)}>🗑 Delete</button>
                  {note.item_id && <button style={S.chip} onClick={() => { const it = items.find(x => x.id === note.item_id); if (it) setModal({ type: 'itemActions', data: it }); }}>→ Item</button>}
                </div>}
              </div>;
            });
          })()}
        </div>}

        {/* ═══ ACCOUNT ═══ */}
        {tab === 'account' && <div>
          <div style={S.ph}><h1 style={{ fontSize: 22, fontWeight: 700 }}>Account</h1></div>
          <div style={{ ...S.card, marginBottom: 10 }}><div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><p style={{ fontSize: 14, fontWeight: 600 }}>{user?.email}</p><button style={{ ...S.chip, color: 'var(--red)' }} onClick={() => db.signOut()}>Sign Out</button></div></div>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: '16px 0 8px' }}>Business Info</h3>
          <div style={{ ...S.card, padding: 16 }}>
            <Lbl t="Business Name" /><input style={S.input} value={biz.business_name || ''} onChange={e => setBiz({ ...biz, business_name: e.target.value })} />
            <Lbl t="Address" /><input style={S.input} value={biz.address || ''} onChange={e => setBiz({ ...biz, address: e.target.value })} />
            <Lbl t="Phone" /><input style={S.input} value={biz.phone || ''} onChange={e => setBiz({ ...biz, phone: e.target.value })} />
            <Lbl t="Email" /><input style={S.input} value={biz.email || ''} onChange={e => setBiz({ ...biz, email: e.target.value })} />
            <Lbl t="HST #" /><input style={S.input} value={biz.hst || ''} onChange={e => setBiz({ ...biz, hst: e.target.value })} />
            <button style={{ ...S.btnP, width: '100%', marginTop: 12 }} onClick={async () => { await db.upsertSettings(biz); notify('ok', 'Saved'); }}>Save</button>
          </div>
          <button style={S.dangerBtn} onClick={async () => { if (!confirm('Delete ALL?')) return; await db.clearAllData(); await load(); notify('ok', 'Cleared'); }}>Reset All Data</button>
        </div>}
      </main>

      {/* NAV */}
      <nav style={S.nav}>{TABS.map(t => <button key={t.id} onClick={() => { setTab(t.id); setSearch(''); }} style={{ ...S.navI, color: tab === t.id ? 'var(--accent)' : 'var(--text-muted)' }}><span style={{ fontSize: 18 }}>{t.icon}</span><span style={{ fontSize: 9, fontWeight: tab === t.id ? 700 : 400 }}>{t.label}</span>{t.id === 'inventory' && items.length > 0 && <span style={S.badge}>{items.length}</span>}{t.id === 'sales' && dueBills.length > 0 && <span style={{ ...S.badge, background: 'var(--red)' }}>{dueBills.length}</span>}{t.id === 'issues' && openNotes.length > 0 && <span style={{ ...S.badge, background: '#F59E0B' }}>{openNotes.length}</span>}</button>)}</nav>

      {/* ═══ MODALS ═══ */}

      {/* INVOICE VIEW */}
      {modal?.type === 'invoiceView' && <OL close={closeModal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><div><h3 style={S.mT}>{modal.data.auction_house}</h3><p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{fmtDate(modal.data.date)} · #{modal.data.invoice_number}</p></div><Pill text={modal.data.payment_status || 'Due'} ok={modal.data.payment_status === 'Paid'} /></div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>{[['LOT', modal.data.lot_total], ['PREMIUM', modal.data.premium_total], ['TAX', modal.data.tax_total]].map(([l, v]) => <div key={l} style={{ flex: 1, background: 'var(--bg-surface)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}><p style={{ fontSize: 9, color: 'var(--text-muted)' }}>{l}</p><p style={{ fontSize: 14, fontWeight: 600 }}>{fmt(v)}</p></div>)}<div style={{ flex: 1, background: 'var(--accent-light)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}><p style={{ fontSize: 9, color: 'var(--accent)' }}>TOTAL</p><p style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>{fmt(modal.data.grand_total)}</p></div></div>
        <div style={{ display: 'flex', gap: 0, marginBottom: 12, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}><button style={{ ...S.segBtn, ...(invDetailTab === 'items' ? S.segAct : {}) }} onClick={() => setInvDetailTab('items')}>📊 Items ({invDetailItems.length})</button><button style={{ ...S.segBtn, ...(invDetailTab === 'original' ? S.segAct : {}) }} onClick={() => setInvDetailTab('original')}>📄 Original</button></div>
        {invDetailTab === 'items' && (invDetailItems.length === 0 ? <div style={{ textAlign: 'center', padding: 20 }}><div style={S.spinner} /></div> : invDetailItems.map((it, idx) => <div key={it.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-light)' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><div style={{ flex: 1, minWidth: 0 }}><p style={{ fontSize: 14, fontWeight: 600 }}>{idx + 1}. {it.title}</p><p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Lot #{it.lot_number}</p>{it.description && <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{it.description.slice(0, 100)}</p>}</div><div style={{ textAlign: 'right', flexShrink: 0 }}><p style={{ fontSize: 14, fontWeight: 700 }}>{fmt(it.hammer_price)}</p><p style={{ fontSize: 10, color: 'var(--text-muted)' }}>+{fmt(it.premium_amount)} +{fmt(it.tax_amount)}</p><p style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>{fmt(it.total_cost)}</p></div></div></div>))}
        {invDetailTab === 'original' && (!viewInvUrl ? <div style={{ textAlign: 'center', padding: 30 }}><div style={S.spinner} /></div> : modal.data.file_type?.includes('pdf') ? <iframe src={viewInvUrl} style={{ width: '100%', height: '55vh', borderRadius: 8, border: '1px solid var(--border)' }} /> : <img src={viewInvUrl} alt="" style={{ width: '100%', borderRadius: 8 }} />)}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}><button style={{ ...S.btnO, flex: 1 }} onClick={() => { handleInvStatus(modal.data, modal.data.payment_status === 'Paid' ? 'Due' : 'Paid'); closeModal(); }}>{modal.data.payment_status === 'Paid' ? '⏳ Due' : '✅ Paid'}</button><button style={{ ...S.btnO, flex: 1, color: 'var(--red)' }} onClick={() => { db.deleteItemsByInvoice(modal.data.id).then(() => db.deleteInvoice(modal.data.id)).then(load); closeModal(); }}>🗑 Delete</button></div>
      </OL>}

      {/* ITEM ACTIONS */}
      {modal?.type === 'itemActions' && <OL close={closeModal}>
        <h3 style={S.mT}>{modal.data.title}</h3><p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>Lot #{modal.data.lot_number} · {fmt(modal.data.total_cost)}</p>
        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>PURPOSE</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}><button style={{ ...S.togBtn, ...(modal.data.purpose !== 'personal' ? S.togAct : {}) }} onClick={() => { setItemPurpose(modal.data, 'for_sale'); closeModal(); }}>🏷 For Sale</button><button style={{ ...S.togBtn, ...(modal.data.purpose === 'personal' ? S.togAct : {}) }} onClick={() => { setItemPurpose(modal.data, 'personal'); closeModal(); }}>🏠 Personal</button></div>
        {modal.data.purpose !== 'personal' && <><p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>LISTING</p><MBtn icon="📋" label="Pending List" onClick={() => { setListingStatus(modal.data, 'pending_list'); closeModal(); }} /><MBtn icon="🟢" label="Go Live" onClick={() => setModal({ type: 'goLive', data: modal.data })} />{(modal.data.listing_status === 'pending_list' || modal.data.listing_status === 'live_listed') && <MBtn icon="↩" label="Unlist" onClick={() => { setListingStatus(modal.data, 'none'); closeModal(); }} />}</>}
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 10 }}>
          <MBtn icon="💰" label="Sell" onClick={() => { closeModal(); setTimeout(() => setModal({ type: 'sell', data: modal.data }), 50); }} />
          <MBtn icon="💬" label="Add Note / Issue" onClick={() => { const d = modal.data; closeModal(); setTimeout(() => { setModal({ type: 'notes', data: d, isSold: false }); loadItemNotes(d.id, null); }, 50); }} />
          <MBtn icon="📷" label="Photos" onClick={() => { const d = modal.data; closeModal(); setTimeout(() => { setModal({ type: 'photos', data: d }); loadPhotos(d.id); }, 50); }} />
          <MBtn icon="🔄" label="Timeline" onClick={() => { const d = modal.data; closeModal(); setTimeout(() => handleLC(d, false), 50); }} />
        </div>
      </OL>}

      {/* ──── NOTES / COMMENTS MODAL ──── */}
      {modal?.type === 'notes' && <OL close={closeModal}>
        <h3 style={S.mT}>Notes — {modal.data.title}</h3>

        {/* Add note form */}
        <div style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Add Note</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {NOTE_CATEGORIES.map(cat => (
              <button key={cat.id} onClick={() => setNoteForm({ ...noteForm, category: cat.id })} style={{ padding: '5px 10px', borderRadius: 20, border: noteForm.category === cat.id ? `2px solid ${cat.color}` : '1px solid var(--border)', background: noteForm.category === cat.id ? cat.bg : 'var(--bg-card)', fontSize: 11, fontFamily: 'var(--font)', cursor: 'pointer', color: noteForm.category === cat.id ? cat.color : 'var(--text-secondary)', fontWeight: noteForm.category === cat.id ? 600 : 400 }}>
                {cat.icon} {cat.label}
              </button>
            ))}
          </div>
          <textarea style={{ ...S.input, minHeight: 60, resize: 'vertical', fontFamily: 'var(--font)' }} placeholder="Describe the issue or add a note..." value={noteForm.note} onChange={e => setNoteForm({ ...noteForm, note: e.target.value })} />
          <button style={{ ...S.btnP, width: '100%', marginTop: 8 }} onClick={() => addNote(modal.isSold ? null : modal.data.id, modal.isSold ? modal.data.id : null)} disabled={!noteForm.note.trim()}>Add Note</button>
        </div>

        {/* Existing notes */}
        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>History ({itemNotes.length})</p>
        {itemNotes.length === 0 ? <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 16 }}>No notes yet</p> :
          itemNotes.map(note => {
            const cat = getCat(note.category);
            return <div key={note.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-light)', opacity: note.is_resolved ? 0.5 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: cat.color, padding: '2px 8px', borderRadius: 6, background: cat.bg }}>{cat.icon} {cat.label}</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{fmtTs(note.created_at)}</span>
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.4, marginBottom: 4, textDecoration: note.is_resolved ? 'line-through' : 'none' }}>{note.note}</p>
              {!note.is_resolved && <div style={{ display: 'flex', gap: 6 }}>
                <button style={{ ...S.chip, fontSize: 11, background: 'var(--green-light)', color: 'var(--green)' }} onClick={() => resolveNote(note.id, modal.isSold ? null : modal.data.id, modal.isSold ? modal.data.id : null)}>✅ Resolve</button>
                <button style={{ ...S.chip, fontSize: 11, color: 'var(--red)' }} onClick={() => deleteNoteById(note.id, modal.isSold ? null : modal.data.id, modal.isSold ? modal.data.id : null)}>🗑</button>
              </div>}
              {note.is_resolved && <p style={{ fontSize: 10, color: 'var(--green)' }}>Resolved {fmtTs(note.resolved_at)}</p>}
            </div>;
          })
        }
      </OL>}

      {/* GO LIVE */}
      {modal?.type === 'goLive' && <OL close={closeModal}>
        <h3 style={S.mT}>List Live — {modal.data.title}</h3>

        {/* URL + Extract */}
        <Lbl t="Listing URL" />
        <div style={{ display: 'flex', gap: 6 }}>
          <input style={{ ...S.input, flex: 1 }} type="url" placeholder="https://facebook.com/marketplace/..." value={sf.listingUrl} onChange={e => { setSf({ ...sf, listingUrl: e.target.value }); setExtractData(null); }} />
          <button style={{ ...S.btnP, padding: '10px 14px', fontSize: 13, flexShrink: 0, opacity: (!sf.listingUrl || extractBusy) ? 0.5 : 1 }} disabled={!sf.listingUrl || extractBusy} onClick={async () => {
            setExtractBusy(true); setExtractData(null);
            try {
              const data = await extractListing(sf.listingUrl);
              setExtractData(data);
              // Auto-fill fields from extracted data
              if (data.price && !sf.amount) setSf(prev => ({ ...prev, amount: String(data.price) }));
              if (data.siteName && !sf.platform) {
                const site = data.siteName.toLowerCase();
                const platform = site.includes('facebook') ? 'Facebook Marketplace' : site.includes('kijiji') ? 'Kijiji' : site.includes('ebay') ? 'eBay' : data.siteName;
                setSf(prev => ({ ...prev, platform }));
              }
              notify('ok', 'Extracted listing data!');
            } catch (err) { notify('err', err.message); }
            setExtractBusy(false);
          }}>{extractBusy ? '...' : '🔍 Extract'}</button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Paste link & tap Extract to auto-fill price, platform & images</p>

        {/* Extracted preview */}
        {extractData && !extractData.error && <div style={{ background: 'var(--bg-surface)', borderRadius: 10, padding: 12, marginTop: 10, marginBottom: 6 }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--green)', marginBottom: 6 }}>✅ Extracted from {extractData.siteName || 'listing'}</p>
          {extractData.image && <img src={extractData.image} alt="" style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 8, marginBottom: 8 }} onError={e => { e.target.style.display = 'none'; }} />}
          {extractData.title && <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{extractData.title}</p>}
          {extractData.description && <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, lineHeight: 1.3 }}>{extractData.description.slice(0, 150)}{extractData.description.length > 150 ? '...' : ''}</p>}
          {extractData.price && <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>${extractData.price.toFixed(2)} {extractData.currency}</p>}
          {/* Save extracted images to item */}
          {extractData.images && extractData.images.length > 1 && <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{extractData.images.length} images found</p>}
        </div>}
        {extractData?.error && <p style={{ fontSize: 12, color: 'var(--red)', marginTop: 6 }}>{extractData.error}</p>}

        <Lbl t="Platform" /><input style={S.input} placeholder="Facebook, Kijiji, eBay..." value={sf.platform} onChange={e => setSf({ ...sf, platform: e.target.value })} />
        <Lbl t="Asking Price" /><input style={S.input} type="number" step="0.01" placeholder="0.00" value={sf.amount} onChange={e => setSf({ ...sf, amount: e.target.value })} />

        <button style={{ ...S.btnP, width: '100%', marginTop: 14 }} onClick={async () => {
          const updates = { listing_status: 'live_listed', listing_platform: sf.platform, listed_at: new Date().toISOString() };
          if (sf.amount) updates.listing_price = parseFloat(sf.amount);
          if (sf.listingUrl) updates.listing_url = sf.listingUrl;
          await db.updateItem(modal.data.id, updates);
          await db.addLifecycleEvent({ item_id: modal.data.id, event: 'Listed Live', detail: `${sf.platform || ''}${sf.amount ? ' · $' + sf.amount : ''}${sf.listingUrl ? ' · ' + sf.listingUrl : ''}` });
          await load(); closeModal(); notify('ok', 'Listed Live!');
        }}>🟢 Go Live</button>
      </OL>}

      {/* SELL */}
      {modal?.type === 'sell' && <OL close={closeModal}>
        <h3 style={S.mT}>Sell — {modal.data.title}</h3><p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>Cost: {fmt(modal.data.total_cost)}</p>
        <Lbl t="Amount *" /><input style={S.input} type="number" step="0.01" value={sf.amount} onChange={e => setSf({ ...sf, amount: e.target.value })} autoFocus />
        <Lbl t="Platform" /><input style={S.input} value={sf.platform} onChange={e => setSf({ ...sf, platform: e.target.value })} />
        <Lbl t="Buyer" /><input style={S.input} value={sf.buyer} onChange={e => setSf({ ...sf, buyer: e.target.value })} />
        <Lbl t="Email" /><input style={S.input} type="email" value={sf.buyerEmail} onChange={e => setSf({ ...sf, buyerEmail: e.target.value })} />
        <Lbl t="Phone" /><input style={S.input} type="tel" value={sf.buyerPhone} onChange={e => setSf({ ...sf, buyerPhone: e.target.value })} />
        <Lbl t="Payment" /><div style={{ display: 'flex', gap: 8, marginBottom: 8 }}><button style={{ ...S.togBtn, ...(sf.billStatus === 'paid' ? S.togAct : {}) }} onClick={() => setSf({ ...sf, billStatus: 'paid' })}>✅ Paid</button><button style={{ ...S.togBtn, ...(sf.billStatus === 'due' ? { ...S.togAct, background: 'var(--red-light)', color: 'var(--red)', borderColor: 'var(--red)' } : {}) }} onClick={() => setSf({ ...sf, billStatus: 'due' })}>⏳ Due</button></div>
        {/* HST Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: 8, marginBottom: 8 }}>
          <div><p style={{ fontSize: 14, fontWeight: 500 }}>Include HST (13%)</p><p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Add tax to bill of sale</p></div>
          <button onClick={() => setSf({ ...sf, includeHst: !sf.includeHst })} style={{ width: 48, height: 28, borderRadius: 14, border: 'none', background: sf.includeHst ? 'var(--green)' : 'var(--border)', position: 'relative', cursor: 'pointer', transition: 'background .2s' }}><div style={{ width: 22, height: 22, borderRadius: 11, background: '#fff', position: 'absolute', top: 3, left: sf.includeHst ? 23 : 3, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} /></button>
        </div>
        {sf.amount && (() => { const sub = parseFloat(sf.amount); const tax = sf.includeHst ? +(sub * 0.13).toFixed(2) : 0; const total = sub + tax; const p = total - parseFloat(modal.data.total_cost); return <div style={{ borderRadius: 8, marginTop: 6, overflow: 'hidden' }}><div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 14px', background: 'var(--bg-surface)' }}><span style={{ fontSize: 13 }}>Subtotal</span><span style={{ fontSize: 13, fontWeight: 600 }}>{fmt(sub)}</span></div>{sf.includeHst && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 14px', background: 'var(--bg-surface)' }}><span style={{ fontSize: 13 }}>HST 13%</span><span style={{ fontSize: 13, fontWeight: 600 }}>{fmt(tax)}</span></div>}{sf.includeHst && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 14px', background: 'var(--bg-surface)' }}><span style={{ fontSize: 13, fontWeight: 600 }}>Bill Total</span><span style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>{fmt(total)}</span></div>}<div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 14px', background: p >= 0 ? 'var(--green-light)' : 'var(--red-light)' }}><span style={{ fontSize: 14 }}>Profit</span><span style={{ fontWeight: 700, color: p >= 0 ? 'var(--green)' : 'var(--red)' }}>{p >= 0 ? '+' : ''}{fmt(p)}</span></div></div>; })()}
        <button style={{ ...S.btnP, width: '100%', marginTop: 14 }} onClick={handleSell} disabled={!sf.amount}>Confirm & Generate Bill</button>
      </OL>}

      {/* BILL OF SALE */}
      {modal?.type === 'billOfSale' && <OL close={closeModal}>
        <h3 style={S.mT}>Bill of Sale</h3>
        <Lbl t="Search Items" /><input style={S.input} placeholder="Search..." value={billSearch} onChange={e => setBillSearch(e.target.value)} />
        {billSearch && <div style={{ maxHeight: 150, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginTop: 4, marginBottom: 8 }}>{items.filter(i => i.purpose !== 'personal' && !billItems.find(b => b.id === i.id) && [i.title, i.lot_number].some(f => f?.toLowerCase().includes(billSearch.toLowerCase()))).map(i => <div key={i.id} style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-light)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }} onClick={() => { setBillItems(p => [...p, { ...i, sellPrice: '' }]); setBillSearch(''); }}><span style={{ fontSize: 13 }}>{i.title}</span><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmt(i.total_cost)}</span></div>)}</div>}
        {billItems.length > 0 && <div style={{ marginBottom: 12 }}><p style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Items ({billItems.length})</p>{billItems.map((bi, idx) => <div key={bi.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border-light)' }}><div style={{ flex: 1, minWidth: 0 }}><p style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bi.title}</p><p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmt(bi.total_cost)}</p></div><input style={{ ...S.input, width: 100, minWidth: 80, flexShrink: 0, padding: '6px 8px', textAlign: 'right' }} type="number" step="0.01" placeholder="Price" value={bi.sellPrice} onChange={e => setBillItems(p => p.map((b, i) => i === idx ? { ...b, sellPrice: e.target.value } : b))} /><button style={{ background: 'none', border: 'none', color: 'var(--red)', fontSize: 16, flexShrink: 0 }} onClick={() => setBillItems(p => p.filter((_, i) => i !== idx))}>✕</button></div>)}
          {(() => { const sub = billItems.reduce((s, i) => s + (parseFloat(i.sellPrice) || 0), 0); const tax = sf.includeHst ? +(sub * 0.13).toFixed(2) : 0; return <div style={{ padding: '8px 0' }}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}><span>Subtotal</span><span style={{ fontWeight: 600 }}>{fmt(sub)}</span></div>{sf.includeHst && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-secondary)' }}><span>HST 13%</span><span>{fmt(tax)}</span></div>}<div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700, paddingTop: 4 }}><span>Total</span><span style={{ color: 'var(--accent)' }}>{fmt(sub + tax)}</span></div></div>; })()}
        </div>}
        <Lbl t="Buyer *" /><input style={S.input} value={sf.buyer} onChange={e => setSf({ ...sf, buyer: e.target.value })} />
        <Lbl t="Email" /><input style={S.input} type="email" value={sf.buyerEmail} onChange={e => setSf({ ...sf, buyerEmail: e.target.value })} />
        <Lbl t="Phone" /><input style={S.input} type="tel" value={sf.buyerPhone} onChange={e => setSf({ ...sf, buyerPhone: e.target.value })} />
        <Lbl t="Payment" /><div style={{ display: 'flex', gap: 8, marginBottom: 8 }}><button style={{ ...S.togBtn, ...(sf.billStatus === 'paid' ? S.togAct : {}) }} onClick={() => setSf({ ...sf, billStatus: 'paid' })}>✅ Paid</button><button style={{ ...S.togBtn, ...(sf.billStatus === 'due' ? { ...S.togAct, background: 'var(--red-light)', color: 'var(--red)', borderColor: 'var(--red)' } : {}) }} onClick={() => setSf({ ...sf, billStatus: 'due' })}>⏳ Due</button></div>
        {/* HST Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: 8, marginBottom: 8 }}>
          <div><p style={{ fontSize: 14, fontWeight: 500 }}>Include HST (13%)</p><p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Add tax to bill</p></div>
          <button onClick={() => setSf({ ...sf, includeHst: !sf.includeHst })} style={{ width: 48, height: 28, borderRadius: 14, border: 'none', background: sf.includeHst ? 'var(--green)' : 'var(--border)', position: 'relative', cursor: 'pointer', transition: 'background .2s' }}><div style={{ width: 22, height: 22, borderRadius: 11, background: '#fff', position: 'absolute', top: 3, left: sf.includeHst ? 23 : 3, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} /></button>
        </div>
        <button style={{ ...S.btnP, width: '100%', marginTop: 10 }} onClick={handleBillOfSale} disabled={!billItems.length || !sf.buyer || billItems.some(b => !b.sellPrice)}>Generate Bill</button>
      </OL>}

      {/* BILL PREVIEW */}
      {modal?.type === 'billPreview' && <OL close={closeModal}><h3 style={S.mT}>Bill — {modal.data.receipt_number}</h3><Pill text={modal.data.bill_status === 'due' ? 'Due' : 'Paid'} ok={modal.data.bill_status !== 'due'} /><div style={{ background: '#fff', borderRadius: 8, maxHeight: '40vh', overflow: 'auto', margin: '12px 0', border: '1px solid var(--border)' }} dangerouslySetInnerHTML={{ __html: billHtml || modal.data.receipt_html }} /><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><button style={S.btnP} onClick={() => printHTML(billHtml || modal.data.receipt_html)}>🖨 Print</button><button style={S.btnO} onClick={() => { setEmailTo(modal.data.sold_buyer_email || ''); setModal({ type: 'email', data: modal.data }); }}>📧 Email</button><button style={S.btnO} onClick={() => openWhatsApp(modal.data.sold_buyer_phone, `Bill #${modal.data.receipt_number}\n${buildReceiptText(modal.data, { name: biz.business_name, phone: biz.phone })}`)}>📱 WhatsApp</button><button style={S.btnO} onClick={() => { navigator.clipboard?.writeText(`Bill #${modal.data.receipt_number}\n${buildReceiptText(modal.data, { name: biz.business_name, address: biz.address, phone: biz.phone })}`); notify('ok', 'Copied'); }}>📋 Copy</button></div>{modal.data.bill_status === 'due' && <button style={{ ...S.btnP, width: '100%', marginTop: 10, background: 'var(--green)' }} onClick={() => { markBillPaid(modal.data); closeModal(); }}>✅ Mark Paid</button>}</OL>}

      {/* EDIT SOLD */}
      {modal?.type === 'editSold' && <OL close={closeModal}>
        <h3 style={S.mT}>Edit Sale — {modal.data.title}</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Your cost: {fmt(modal.data.total_cost)} · {modal.data.receipt_number}</p>
        <Lbl t="Sale Amount" /><input style={S.input} type="number" step="0.01" value={sf.amount} onChange={e => setSf({ ...sf, amount: e.target.value })} autoFocus />
        <Lbl t="Platform" /><input style={S.input} value={sf.platform} onChange={e => setSf({ ...sf, platform: e.target.value })} placeholder="Facebook, Kijiji..." />
        <Lbl t="Buyer Name" /><input style={S.input} value={sf.buyer} onChange={e => setSf({ ...sf, buyer: e.target.value })} />
        <Lbl t="Buyer Email" /><input style={S.input} type="email" value={sf.buyerEmail} onChange={e => setSf({ ...sf, buyerEmail: e.target.value })} />
        <Lbl t="Buyer Phone" /><input style={S.input} type="tel" value={sf.buyerPhone} onChange={e => setSf({ ...sf, buyerPhone: e.target.value })} />
        <Lbl t="Payment Status" />
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button style={{ ...S.togBtn, ...(sf.billStatus === 'paid' ? S.togAct : {}) }} onClick={() => setSf({ ...sf, billStatus: 'paid' })}>✅ Paid</button>
          <button style={{ ...S.togBtn, ...(sf.billStatus === 'due' ? { ...S.togAct, background: 'var(--red-light)', color: 'var(--red)', borderColor: 'var(--red)' } : {}) }} onClick={() => setSf({ ...sf, billStatus: 'due' })}>⏳ Due</button>
        </div>
        {sf.amount && (() => { const p = parseFloat(sf.amount) - parseFloat(modal.data.total_cost); return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: p >= 0 ? 'var(--green-light)' : 'var(--red-light)', borderRadius: 8 }}><span>Profit</span><span style={{ fontWeight: 700, color: p >= 0 ? 'var(--green)' : 'var(--red)' }}>{p >= 0 ? '+' : ''}{fmt(p)}</span></div>; })()}
        <button style={{ ...S.btnP, width: '100%', marginTop: 14 }} onClick={handleEditSold} disabled={!sf.amount}>Save Changes</button>
        <button style={{ width: '100%', marginTop: 8, padding: '12px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 14, fontFamily: 'var(--font)', cursor: 'pointer', color: 'var(--blue)', textAlign: 'center' }} onClick={() => { closeModal(); returnToInventory(modal.data); }}>↩ Return to Inventory</button>
      </OL>}

      {/* PHOTOS */}
      {modal?.type === 'photos' && <OL close={closeModal}><h3 style={S.mT}>Photos</h3><label role="button" style={{ ...S.btnP, display: 'block', textAlign: 'center', marginBottom: 12 }}><input type="file" accept="image/*" multiple onChange={e => handlePhoto(modal.data.id, e)} style={{ display: 'none' }} />Upload</label>{(itemPhotos[modal.data.id] || []).length > 0 ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>{(itemPhotos[modal.data.id]).map((p, i) => <div key={p.id || i} style={{ position: 'relative', aspectRatio: '1', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-surface)' }}>{p.url ? <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>...</div>}<button onClick={() => handleDeletePhoto(modal.data.id, p)} style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12, background: 'rgba(0,0,0,.6)', color: '#fff', border: 'none', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>✕</button></div>)}</div> : <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>No photos</p>}</OL>}

      {/* RECEIPT */}
      {modal?.type === 'receipt' && <OL close={closeModal}><h3 style={S.mT}>Receipt</h3>{receiptBusy ? <div style={{ textAlign: 'center', padding: 30 }}><div style={S.spinner} /></div> : <div><div style={{ background: '#fff', borderRadius: 8, maxHeight: '40vh', overflow: 'auto', marginBottom: 10, border: '1px solid var(--border)' }} dangerouslySetInnerHTML={{ __html: receiptHtml }} /><button style={S.btnP} onClick={() => printHTML(receiptHtml)}>🖨 Print</button></div>}</OL>}

      {/* SHARE */}
      {modal?.type === 'share' && <OL close={closeModal}><h3 style={S.mT}>Share</h3><MBtn icon="🧾" label="View Bill" onClick={() => { closeModal(); setTimeout(() => viewBill(modal.data), 50); }} /><MBtn icon="📧" label="Email" onClick={() => { setEmailTo(modal.data.sold_buyer_email || ''); setModal({ type: 'email', data: modal.data }); }} /><MBtn icon="📱" label="WhatsApp" onClick={() => openWhatsApp(modal.data.sold_buyer_phone, buildReceiptText(modal.data, { name: biz.business_name, phone: biz.phone }))} /><MBtn icon="📋" label="Copy" onClick={() => { navigator.clipboard?.writeText(buildReceiptText(modal.data, { name: biz.business_name, address: biz.address, phone: biz.phone })); notify('ok', 'Copied'); closeModal(); }} /></OL>}

      {/* EMAIL */}
      {modal?.type === 'email' && <OL close={closeModal}><h3 style={S.mT}>Email</h3><Lbl t="To" /><input style={S.input} type="email" value={emailTo} onChange={e => setEmailTo(e.target.value)} autoFocus /><button style={{ ...S.btnP, width: '100%', marginTop: 14 }} onClick={handleEmail} disabled={!emailTo}>Send</button></OL>}

      {/* LIFECYCLE */}
      {modal?.type === 'lc' && <OL close={closeModal}><h3 style={S.mT}>Timeline</h3><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}><NB l="Cost" v={fmt(modal.data.total_cost)} />{modal.data.sold_price && <NB l="Sold" v={fmt(modal.data.sold_price)} />}{modal.data.profit && <NB l="Profit" v={`${parseFloat(modal.data.profit) >= 0 ? '+' : ''}${fmt(modal.data.profit)}`} c={parseFloat(modal.data.profit) >= 0 ? 'var(--green)' : 'var(--red)'} />}</div><div style={{ borderLeft: '2px solid var(--border)', marginLeft: 6, paddingLeft: 14 }}>{lcEvents.map((ev, i) => <div key={ev.id} style={{ paddingBottom: 12, position: 'relative' }}><div style={{ position: 'absolute', left: -21, top: 4, width: 8, height: 8, borderRadius: 4, background: i === lcEvents.length - 1 ? 'var(--accent)' : 'var(--border)' }} /><p style={{ fontSize: 14, fontWeight: 500 }}>{ev.event}</p><p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtTs(ev.created_at)}</p><p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{ev.detail}</p></div>)}</div></OL>}
    </div>
  );
}

// ── Components ──
function OL({ close, children }) { return <div style={S.overlay} onClick={close}><div className="slide-up" style={S.modal} onClick={e => e.stopPropagation()}><div style={S.handle} />{children}</div></div>; }
function Pill({ text, ok, color, bg }) { return <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: bg || (ok ? 'var(--green-light)' : 'var(--red-light)'), color: color || (ok ? 'var(--green)' : 'var(--red)') }}>{text}</span>; }
function Empty({ text }) { return <div style={{ textAlign: 'center', padding: 36 }}><p style={{ fontSize: 32 }}>📭</p><p style={{ fontSize: 14, color: 'var(--text-muted)' }}>{text}</p></div>; }
function Lbl({ t }) { return <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', margin: '10px 0 3px' }}>{t}</label>; }
function NB({ l, v, c }) { return <div style={{ background: 'var(--bg-surface)', borderRadius: 8, padding: '6px 12px', flex: '1 1 70px' }}><p style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{l}</p><p style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: c || 'var(--text)' }}>{v}</p></div>; }
function MBtn({ icon, label, onClick, color }) { return <button style={{ ...S.mi, color: color || 'var(--text)' }} onClick={onClick}><span style={{ fontSize: 18 }}>{icon}</span>{label}</button>; }
function Stat({ label, value, sub, color }) { return <div style={{ ...S.sC, borderLeft: `3px solid ${color}` }}><p style={S.sL}>{label}</p><p style={{ ...S.sV, color }}>{value}</p><p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{sub}</p></div>; }
function SC({ si, i, onBill, onShare, onLC, onNote, onMarkPaid, onEdit, onReturn, noteCount }) {
  const p = parseFloat(si.profit);
  return <div className="fade-up" style={{ ...S.card, marginBottom: 8, animationDelay: `${i * 25}ms`, ...(noteCount > 0 ? { borderLeft: '3px solid #F59E0B' } : {}) }}>
    <div style={S.row}><div style={{ ...S.iBox, background: si.bill_status === 'due' ? 'var(--red-light)' : 'var(--green-light)' }}><span style={{ fontSize: 16 }}>{si.bill_status === 'due' ? '⏳' : '✅'}</span></div><div style={{ flex: 1, minWidth: 0 }}><p style={S.cT}>{si.title}</p><p style={S.cS}>{si.sold_buyer || 'Walk-in'} · {fmtTs(si.sold_at)}</p>{noteCount > 0 && <Pill text={`${noteCount} issue${noteCount > 1 ? 's' : ''}`} color="#92400E" bg="#FEF3C7" />}</div><div style={{ textAlign: 'right', flexShrink: 0 }}><p style={{ fontSize: 15, fontWeight: 700 }}>{fmt(si.sold_price)}</p><p style={{ fontSize: 12, fontWeight: 600, color: p >= 0 ? 'var(--green)' : 'var(--red)' }}>{p >= 0 ? '+' : ''}{fmt(si.profit)}</p><Pill text={si.bill_status === 'due' ? 'Due' : 'Paid'} ok={si.bill_status !== 'due'} /></div></div>
    <div style={S.acts}>{onMarkPaid && <button style={{ ...S.chip, background: 'var(--green-light)', color: 'var(--green)', fontWeight: 600 }} onClick={onMarkPaid}>✅ Paid</button>}<button style={{ ...S.chip, background: 'var(--accent-light)', color: 'var(--accent)', fontWeight: 600 }} onClick={onBill}>🧾</button>{onEdit && <button style={S.chip} onClick={onEdit}>✏️ Edit</button>}{onReturn && <button style={S.chip} onClick={onReturn}>↩</button>}<button style={S.chip} onClick={onNote}>💬{noteCount > 0 ? ` ${noteCount}` : ''}</button><button style={S.chip} onClick={onShare}>📤</button><button style={S.chip} onClick={onLC}>🔄</button></div>
  </div>;
}

const S={app:{display:'flex',flexDirection:'column',height:'100%',background:'var(--bg)'},splash:{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100vh',background:'var(--bg)'},logoBig:{width:56,height:56,borderRadius:16,background:'var(--accent)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,filter:'brightness(10)',marginBottom:16},spinner:{width:28,height:28,border:'3px solid var(--border)',borderTopColor:'var(--accent)',borderRadius:'50%',animation:'spin .8s linear infinite'},miniSpin:{width:14,height:14,border:'2px solid rgba(255,255,255,.4)',borderTopColor:'#fff',borderRadius:'50%',animation:'spin .6s linear infinite',flexShrink:0,marginRight:8},toast:{position:'fixed',top:12,left:16,right:16,padding:'12px 16px',borderRadius:12,color:'#fff',fontSize:14,fontWeight:500,display:'flex',alignItems:'center',zIndex:200,boxShadow:'0 4px 12px rgba(0,0,0,.15)'},fullOL:{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',zIndex:300},main:{flex:1,overflow:'auto',padding:'0 16px',paddingBottom:'calc(64px + env(safe-area-inset-bottom, 0px))'},ph:{padding:'16px 0 10px'},nav:{display:'flex',justifyContent:'space-around',background:'var(--bg-card)',borderTop:'1px solid var(--border)',position:'fixed',bottom:0,left:0,right:0,zIndex:50,paddingBottom:'env(safe-area-inset-bottom, 0px)'},navI:{display:'flex',flexDirection:'column',alignItems:'center',gap:1,padding:'6px 0',minWidth:50,background:'none',border:'none',fontFamily:'var(--font)',position:'relative'},badge:{position:'absolute',top:0,right:4,background:'var(--accent)',color:'#fff',fontSize:8,fontWeight:700,padding:'1px 4px',borderRadius:10,minWidth:14,textAlign:'center'},sRow:{display:'grid',gridTemplateColumns:'repeat(3, 1fr)',gap:8,marginBottom:14},sC:{background:'var(--bg-card)',borderRadius:12,padding:'10px 12px',boxShadow:'var(--shadow-sm)'},sL:{fontSize:10,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:.5,marginBottom:2},sV:{fontSize:16,fontWeight:700,fontFamily:'var(--font-mono)'},actC:{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6,padding:'20px 12px',background:'var(--bg-card)',borderRadius:12,border:'2px dashed var(--border)',cursor:'pointer',textAlign:'center'},fRow:{display:'flex',gap:6,overflowX:'auto',marginBottom:10,paddingBottom:2},fBtn:{padding:'7px 14px',borderRadius:20,border:'1px solid var(--border)',background:'var(--bg-card)',fontSize:13,color:'var(--text-secondary)',whiteSpace:'nowrap',fontFamily:'var(--font)',cursor:'pointer'},fAct:{background:'var(--accent)',color:'#fff',borderColor:'var(--accent)',fontWeight:600},card:{background:'var(--bg-card)',borderRadius:12,boxShadow:'var(--shadow-sm)',overflow:'hidden'},row:{display:'flex',gap:12,padding:'12px 16px',alignItems:'center',cursor:'pointer'},cT:{fontSize:15,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'},cS:{fontSize:12,color:'var(--text-secondary)'},acts:{display:'flex',gap:6,padding:'8px 16px',borderTop:'1px solid var(--border-light)',flexWrap:'wrap'},iBox:{width:40,height:40,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0},thumb:{width:52,height:52,borderRadius:10,overflow:'hidden',flexShrink:0,background:'var(--bg-surface)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'},tI:{width:'100%',height:'100%',objectFit:'cover'},chip:{padding:'6px 12px',background:'var(--bg-surface)',border:'none',borderRadius:20,fontSize:12,color:'var(--text-secondary)',fontFamily:'var(--font)',cursor:'pointer'},input:{width:'100%',padding:'12px 14px',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:8,fontSize:15,color:'var(--text)',fontFamily:'var(--font)',boxSizing:'border-box',outline:'none'},btnP:{padding:'14px 24px',background:'var(--accent)',color:'#fff',border:'none',borderRadius:10,fontSize:15,fontWeight:600,fontFamily:'var(--font)',textAlign:'center',cursor:'pointer'},btnO:{padding:'12px 16px',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:10,fontSize:14,color:'var(--text)',fontFamily:'var(--font)',textAlign:'center',cursor:'pointer'},linkS:{background:'none',border:'none',color:'var(--accent)',fontSize:13,marginTop:12,width:'100%',textAlign:'center',fontFamily:'var(--font)',cursor:'pointer'},dangerBtn:{width:'100%',padding:14,marginTop:16,background:'var(--red-light)',border:'1px solid var(--red)',borderRadius:10,color:'var(--red)',fontSize:14,fontFamily:'var(--font)',cursor:'pointer'},togBtn:{flex:1,padding:'10px',borderRadius:8,border:'1px solid var(--border)',background:'var(--bg-surface)',fontSize:14,fontFamily:'var(--font)',textAlign:'center',cursor:'pointer',color:'var(--text-secondary)'},togAct:{background:'var(--accent-light)',color:'var(--accent)',borderColor:'var(--accent)',fontWeight:600},mi:{display:'flex',alignItems:'center',gap:12,width:'100%',padding:'14px 16px',background:'var(--bg-surface)',border:'none',borderRadius:8,fontSize:15,fontFamily:'var(--font)',marginBottom:6,textAlign:'left',cursor:'pointer'},segBtn:{flex:1,padding:'10px 0',border:'none',background:'var(--bg-surface)',fontSize:13,fontFamily:'var(--font)',cursor:'pointer',color:'var(--text-secondary)',textAlign:'center'},segAct:{background:'var(--accent)',color:'#fff',fontWeight:600},sumBar:{display:'flex',flexWrap:'wrap',gap:0,background:'var(--bg-card)',borderRadius:10,boxShadow:'var(--shadow-sm)',marginBottom:10,overflow:'hidden'},sumItem:{flex:'1 1 auto',padding:'8px 12px',textAlign:'center',borderRight:'1px solid var(--border-light)',minWidth:70},sumL:{display:'block',fontSize:9,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:.5},sumV:{display:'block',fontSize:13,fontWeight:700,fontFamily:'var(--font-mono)',color:'var(--text)'},overlay:{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',display:'flex',alignItems:'flex-end',justifyContent:'center',zIndex:100},modal:{background:'var(--bg-card)',borderRadius:'20px 20px 0 0',padding:'8px 20px 28px',width:'100%',maxWidth:500,maxHeight:'88vh',overflow:'auto'},handle:{width:36,height:4,background:'var(--border)',borderRadius:4,margin:'0 auto 14px'},mT:{fontSize:18,fontWeight:700,marginBottom:6}};
