import { useState, useEffect, useCallback, useRef } from 'react';
import * as db from './utils/db';
import { parseInvoiceAI, parseInvoicePageAI, parseInvoiceAllPages, generateReceiptAI, generateBillAI, extractListing, sendEmailFallback } from './utils/api';
import { uid, fmt, fmtDate, fmtTs, readFileAsBase64, openWhatsApp, openSMS, printHTML, buildReceiptText } from './utils/helpers';

const TABS = [
  { id: 'home', icon: '🏠', label: 'Home' },
  { id: 'invoices', icon: '📄', label: 'Invoices' },
  { id: 'inventory', icon: '📦', label: 'Stock' },
  { id: 'returns', icon: '↩️', label: 'Returns' },
  { id: 'sales', icon: '💰', label: 'Sales' },
  { id: 'account', icon: '👤', label: 'Me' },
];
const INV_FILTERS = ['All', 'For Sale', 'Sold', 'Listed', 'Booked', 'Personal', 'Damaged', 'Returns'];
const ITEM_STATUSES = [
  { id: 'for_sale', label: 'For Sale', icon: '🏷', color: '#FF6B00', bg: '#FFF4EC' },
  { id: 'sold', label: 'Sold', icon: '✅', color: '#16A34A', bg: '#EAFBF0' },
  { id: 'listed', label: 'Listed', icon: '📋', color: '#0EA5E9', bg: '#E0F2FE' },
  { id: 'booked', label: 'Booked', icon: '🔒', color: '#7C3AED', bg: '#F5F3FF' },
  { id: 'personal', label: 'Personal', icon: '🏠', color: '#2563EB', bg: '#EBF5FF' },
  { id: 'damaged', label: 'Damaged', icon: '⚠️', color: '#DC2626', bg: '#FFF0EF' },
  { id: 'returns', label: 'Returns', icon: '↩️', color: '#C2410C', bg: '#FFF7ED' },
];
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
  const [invItemLots, setInvItemLots] = useState({});
  const [invPrintSelections, setInvPrintSelections] = useState({});
  const fileRef = useRef(null);
  const [invPhotoItemId, setInvPhotoItemId] = useState(null);
  const [invPhotoLot, setInvPhotoLot] = useState('');
  const [invStatusFilter, setInvStatusFilter] = useState('All');
  const [invSearch, setInvSearch] = useState('');
  const [invSort, setInvSort] = useState('newest');
  const [invVendor, setInvVendor] = useState('All');
  const [stockSort, setStockSort] = useState('newest');
  const [photoPreview, setPhotoPreview] = useState(null);
  const [sharePrice, setSharePrice] = useState('');
  const [uploadBusy, setUploadBusy] = useState(false);
  const [returnSearch, setReturnSearch] = useState('');
  const [returnItems, setReturnItems] = useState([]);
  const [returnReasons, setReturnReasons] = useState({});
  const [returnPhotos, setReturnPhotos] = useState({});
  const [savedReturns, setSavedReturns] = useState(() => { try { return JSON.parse(localStorage.getItem('av_returns') || '[]'); } catch { return []; } });
  const [returnTab, setReturnTab] = useState('new');
  const [printIncludeInvoice, setPrintIncludeInvoice] = useState(false);
  const [manualReturn, setManualReturn] = useState({ invoiceNumber: '', bidDate: '', invoiceTotal: '', vendor: '' });
  const [manualReturnItems, setManualReturnItems] = useState([]);
  const [quickSellData, setQuickSellData] = useState({ price: '', payMethod: 'cash', deliveryCharge: '' });
  const [listStoreData, setListStoreData] = useState({ price: '', description: '' });

  const notify = useCallback((t, m) => { setToast({ t, m }); setTimeout(() => setToast(null), t === 'err' ? 8000 : 4000); }, []);
  const closeModal = () => { setModal(null); setReceiptHtml(''); setBillHtml(''); setViewInvUrl(null); setInvDetailItems([]); setInvDetailTab('items'); setLcEvents([]); setEmailTo(''); setBillItems([]); setBillSearch(''); setItemNotes([]); setNoteForm({ category: 'product_defect', note: '' }); setSf({ amount: '', platform: '', buyer: '', buyerEmail: '', buyerPhone: '', billStatus: 'paid', includeHst: true, listingUrl: '' }); setExtractBusy(false); setExtractData(null); setInvItemLots({}); setInvPrintSelections({}); setInvPhotoItemId(null); setInvPhotoLot(''); setPhotoPreview(null); setSharePrice(''); setPrintIncludeInvoice(false); };

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

  const load = useCallback(async () => {
    try {
      const [inv, itm, sld, cust, s, notes, thumbs] = await Promise.all([db.getInvoices(), db.getItems(), db.getSoldItems(), db.getCustomers(), db.getSettings(), db.getAllNotes(), db.getAllThumbnails()]);
      setInvoices(inv); setItems(itm); setSold(sld); setCustomers(cust); setAllNotes(notes); if (s) setBiz(s);
      setItemPhotos(prev => { const m = { ...prev }; for (const [id, p] of Object.entries(thumbs)) { if (!m[id] || m[id].length <= 1) m[id] = p; } return m; });
    } catch (e) { console.error(e); }
  }, []);
  useEffect(() => { if (auth === 'app') load(); }, [auth, load]);

  const loadPhotos = useCallback(async (id) => { try { const p = await db.getPhotoUrls(id, null); setItemPhotos(prev => ({ ...prev, [id]: p })); } catch (e) {} }, []);
  const loadItemNotes = useCallback(async (itemId, soldItemId) => { try { const n = await db.getNotes(itemId, soldItemId); setItemNotes(n); } catch (e) {} }, []);

  const handleUpload = useCallback(async (e) => {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    setUploadBusy(true);
    try {
      const pages = [];
      for (const file of files) {
        const b64 = await readFileAsBase64(file);
        // Compress images to fit Netlify 6MB payload limit
        if (file.type.startsWith('image/')) {
          const compressed = await new Promise(res => {
            const img = new Image();
            img.onload = () => {
              const c = document.createElement('canvas');
              const mx = 1200; let w = img.width, h = img.height;
              if (w > mx || h > mx) { if (w > h) { h = h * (mx / w); w = mx; } else { w = w * (mx / h); h = mx; } }
              c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
              const dataUrl = c.toDataURL('image/jpeg', 0.7);
              res(dataUrl.split(',')[1]); // base64 only
            };
            img.src = 'data:' + file.type + ';base64,' + b64;
          });
          pages.push({ base64: compressed, fileType: 'image/jpeg', fileName: file.name });
        } else {
          pages.push({ base64: b64, fileType: file.type, fileName: file.name });
        }
      }
      let result; let allItems = []; let summaryData = null;

      if (pages.length === 1) {
        try { result = await parseInvoiceAI(pages[0].base64, pages[0].fileType); }
        catch (apiErr) { setUploadBusy(false); if (fileRef.current) fileRef.current.value = ''; notify('err', apiErr.message.includes('truncated') ? 'Invoice too large. Select multiple page images.' : `Upload failed: ${apiErr.message}`); return; }
        if (!result?.invoice || !result?.items?.length) { setUploadBusy(false); if (fileRef.current) fileRef.current.value = ''; notify('err', 'Could not extract items. Try splitting into page photos.'); return; }
        allItems = result.items;
      } else {
        // Step 1: Get invoice header from page 1 only
        notify('info', `Reading invoice header...`);
        try { result = await parseInvoiceAI(pages[0].base64, pages[0].fileType); } catch (e) {}
        if (!result?.invoice) { setUploadBusy(false); if (fileRef.current) fileRef.current.value = ''; notify('err', 'Could not read invoice header.'); return; }

        // Step 2: Index ALL pages in batches of 3 using simple text extraction
        const batchSize = 3;
        for (let i = 0; i < pages.length; i += batchSize) {
          const batch = pages.slice(i, i + batchSize);
          const startPage = i + 1;
          notify('info', `Indexing pages ${startPage}-${Math.min(startPage + batch.length - 1, pages.length)}... (${allItems.length} items)`);
          try {
            const batchResult = await parseInvoiceAllPages(batch, 'index');
            if (batchResult?.items?.length) allItems = [...allItems, ...batchResult.items];
          } catch {
            for (const pg of batch) {
              try { const pr = await parseInvoicePageAI(pg.base64, pg.fileType, 'index', startPage); if (pr?.items?.length) allItems = [...allItems, ...pr.items]; } catch {}
            }
          }
        }

        // Step 3: Get summary from last 2 pages
        for (let i = Math.max(0, pages.length - 2); i < pages.length; i++) {
          try {
            const sr = await parseInvoicePageAI(pages[i].base64, pages[i].fileType, 'summary', i + 1);
            if (sr?.summary) {
              const s = sr.summary;
              if (s.premium_rate) result.invoice.buyer_premium_rate = s.premium_rate;
              if (s.grand_total) result.invoice.grand_total = s.grand_total;
              if (s.lot_total) result.invoice.lot_total = s.lot_total;
              if (s.premium_total) result.invoice.premium_total = s.premium_total;
              if (s.handling_fee_total) result.invoice.handling_fee_total = s.handling_fee_total;
              if (s.tax_total) result.invoice.tax_total = s.tax_total;
            }
          } catch {}
        }

        // Deduplicate by lot_number
        const seen = new Set();
        allItems = allItems.filter(it => { const key = it.lot_number || it.title; if (seen.has(key)) return false; seen.add(key); return true; });

        if (!allItems.length) { setUploadBusy(false); if (fileRef.current) fileRef.current.value = ''; notify('err', 'No items found.'); return; }
        result.items = allItems;
      }

      const ri = result.invoice;
      // ── Get rates from invoice — each invoice is unique ──
      const premiumRate = parseFloat(ri.buyer_premium_rate) || 0;
      const taxRate = parseFloat(ri.tax_rate) || 0.13;

      // ── Calculate each item individually — no grand total distribution ──
      let lotTotal = 0, premiumTotal = 0, handlingTotal = 0, taxTotal = 0, grandTotal = 0;
      const rows_pre = allItems.map(it => {
        const hp = parseFloat(it.hammer_price) || 0;
        const handling = parseFloat(it.handling_fee) || 0;
        const premAmt = +(hp * premiumRate).toFixed(2);
        const taxable = +(hp + premAmt + handling).toFixed(2);
        const taxAmt = +(taxable * taxRate).toFixed(2);
        const totalCost = +(hp + premAmt + handling + taxAmt).toFixed(2);
        lotTotal += hp; premiumTotal += premAmt; handlingTotal += handling; taxTotal += taxAmt; grandTotal += totalCost;
        return { it, hp, handling, premAmt, taxAmt, totalCost };
      });
      lotTotal = +lotTotal.toFixed(2); premiumTotal = +premiumTotal.toFixed(2); handlingTotal = +handlingTotal.toFixed(2); taxTotal = +taxTotal.toFixed(2); grandTotal = +grandTotal.toFixed(2);

      // Prefer ACTUAL invoice totals from summary page over calculated sums (some items may be missed by AI)
      const invLotTotal = parseFloat(ri.lot_total) || lotTotal;
      const invPremiumTotal = parseFloat(ri.premium_total) || premiumTotal;
      const invHandlingTotal = parseFloat(ri.handling_fee_total) || handlingTotal;
      const invTaxTotal = parseFloat(ri.tax_total) || taxTotal;
      const invGrandTotal = parseFloat(ri.grand_total) || grandTotal;

      const dup = await db.findDuplicateInvoice(ri.invoice_number, ri.auction_house, invGrandTotal, ri.date, pages[0].fileName);
      if (dup) { setUploadBusy(false); if (fileRef.current) fileRef.current.value = ''; notify('err', `⚠️ Duplicate! "${dup.auction_house || ''} #${dup.invoice_number || ''}" exists.`); return; }

      const tempId = uid();
      const filePath = await db.uploadInvoiceFile(tempId, pages[0].base64, pages[0].fileName, pages[0].fileType);
      const newInv = await db.insertInvoice({
        date: ri.date, auction_house: ri.auction_house, invoice_number: ri.invoice_number, event_description: ri.event_description,
        payment_method: ri.payment_method, payment_status: ri.payment_status || 'Due', pickup_location: ri.pickup_location,
        buyer_premium_rate: premiumRate, tax_rate: taxRate,
        lot_total: invLotTotal, premium_total: invPremiumTotal, tax_total: invTaxTotal,
        other_fees_total: invHandlingTotal, other_fees_labels: invHandlingTotal > 0 ? 'Handling Fee' : '',
        grand_total: invGrandTotal,
        file_name: pages[0].fileName, file_type: pages[0].fileType, file_path: filePath, item_count: allItems.length
      });
      const rows = rows_pre.map(({ it, hp, handling, premAmt, taxAmt, totalCost }) => {
        return {
          invoice_id: newInv.id, lot_number: it.lot_number, title: it.title, description: it.description, quantity: it.quantity || 1,
          hammer_price: hp, premium_rate: premiumRate, tax_rate: taxRate, premium_amount: premAmt, subtotal: +(hp + premAmt).toFixed(2), tax_amount: taxAmt,
          other_fees: handling, other_fees_desc: handling > 0 ? 'Handling Fee' : '', total_cost: totalCost,
          auction_house: ri.auction_house, date: ri.date, pickup_location: ri.pickup_location, payment_method: ri.payment_method,
          status: 'in_inventory', purpose: 'for_sale', listing_status: 'none'
        };
      });
      const inserted = await db.insertItems(rows);
      const now = new Date().toISOString();
      await db.addLifecycleEvents(inserted.flatMap(it => [{ item_id: it.id, event: 'Purchased', detail: `${ri.auction_house}`, created_at: now }, { item_id: it.id, event: 'In Inventory', detail: `Lot #${it.lot_number} · ${fmt(it.total_cost)}`, created_at: now }]));
      setUploadBusy(false); await load();
      notify('ok', `✅ ${allItems.length} items · ${fmt(grandTotal)}${pages.length > 1 ? ` (${pages.length} pages)` : ''}`);
    } catch (err) { setUploadBusy(false); notify('err', `Upload failed: ${err.message}`); }
    if (fileRef.current) fileRef.current.value = '';
  }, [notify, load]);

  const openInvoice = useCallback(async (inv) => { setModal({ type: 'invoiceView', data: inv }); setInvDetailTab('items'); setViewInvUrl(null); setInvPrintSelections({}); const detailItems = await db.getItemsByInvoice(inv.id); setInvDetailItems(detailItems); if (inv.file_path) setViewInvUrl(await db.getInvoiceFileUrl(inv.file_path)); const lotMap = {}; detailItems.forEach(it => { lotMap[it.id] = it.lot_number || ''; }); setInvItemLots(lotMap); for (const it of detailItems) { loadPhotos(it.id); } }, [loadPhotos]);
  const handleInvStatus = useCallback(async (inv, st) => { await db.updateInvoice(inv.id, { payment_status: st }); await load(); notify('ok', `→ ${st}`); }, [load, notify]);
  const handleUpdateLotNumber = useCallback(async (itemId, lotNumber) => { try { await db.updateItem(itemId, { lot_number: lotNumber }); setInvDetailItems(prev => prev.map(it => it.id === itemId ? { ...it, lot_number: lotNumber } : it)); } catch (e) { notify('err', 'Failed'); } }, [notify]);
  const handleInvItemPhoto = useCallback(async (itemId, e) => {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    if (invPhotoLot) { await handleUpdateLotNumber(itemId, invPhotoLot); setInvItemLots(prev => ({ ...prev, [itemId]: invPhotoLot })); }
    const previews = files.map(f => ({ id: 'temp_' + Date.now() + Math.random(), url: URL.createObjectURL(f), file_name: f.name }));
    setItemPhotos(prev => ({ ...prev, [itemId]: [...(prev[itemId] || []), ...previews] }));
    for (const f of files) { try { await db.uploadPhoto(itemId, f); } catch (err) { console.error(err); } }
    await loadPhotos(itemId); setInvPhotoItemId(null); setInvPhotoLot(''); notify('ok', `${files.length} photo(s) saved`);
  }, [notify, loadPhotos, invPhotoLot, handleUpdateLotNumber]);

  const printInvoiceItems = useCallback(async (invoice, itemsToPrint, detailed = false, includeInvoiceCopy = false) => {
    const perPage = detailed ? 4 : 3;
    const pages = []; for (let i = 0; i < itemsToPrint.length; i += perPage) pages.push(itemsToPrint.slice(i, i + perPage));
    const inv = invoice;
    let invoiceCopyHtml = '';
    if (includeInvoiceCopy) {
      // Fetch original invoice file
      let origFileHtml = '';
      if (inv.file_path) { try { const url = await db.getInvoiceFileUrl(inv.file_path); if (url) { origFileHtml = `<div class="orig-file"><p class="ofl">Original Invoice</p><img src="${url}" style="width:100%;max-height:260mm;object-fit:contain;" onerror="this.parentElement.innerHTML='<p style=text-align:center;color:#999;padding:20mm>Invoice file could not be loaded for print. View it in the app under Invoice → File tab.</p>'"/></div>`; } } catch(e){} }
      invoiceCopyHtml = `<div class="page"><div class="inv-copy"><h2>Invoice Summary</h2><table>
        <tr><td>Auction House</td><td><b>${inv.auction_house||''}</b></td></tr>
        <tr><td>Invoice #</td><td>${inv.invoice_number||''}</td></tr>
        <tr><td>Date</td><td>${inv.date||''}</td></tr>
        <tr><td>Payment</td><td>${inv.payment_method||''} · ${inv.payment_status||''}</td></tr>
        <tr><td>Location</td><td>${inv.pickup_location||''}</td></tr>
        <tr><td>Items</td><td>${inv.item_count||itemsToPrint.length}</td></tr>
        <tr><td>Lot Total</td><td>$${parseFloat(inv.lot_total||0).toFixed(2)}</td></tr>
        <tr><td>Premium</td><td>$${parseFloat(inv.premium_total||0).toFixed(2)}</td></tr>
        <tr><td>Tax</td><td>$${parseFloat(inv.tax_total||0).toFixed(2)}</td></tr>
        ${parseFloat(inv.other_fees_total||0)>0?`<tr><td>${inv.other_fees_labels||'Other Fees'}</td><td>$${parseFloat(inv.other_fees_total).toFixed(2)}</td></tr>`:''}
        <tr><td><b>Grand Total</b></td><td><b>$${parseFloat(inv.grand_total||0).toFixed(2)}</b></td></tr>
        </table><div class="billed-to"><h3>Billed To</h3><p><b>${biz.business_name||'—'}</b></p><p>${biz.address||''}</p><p>${biz.phone||''} ${biz.email?'· '+biz.email:''}</p>${biz.hst?`<p>HST: ${biz.hst}</p>`:''}</div></div></div>${origFileHtml?`<div class="page pb">${origFileHtml}</div>`:''}`;
    }
    const pHTML = pages.map((pg, pi) => `<div class="page${pi > 0 ? ' pb' : ''}">
      <div class="hdr"><div class="hl"></div><h1>${inv.auction_house || 'Invoice'}</h1><p class="sub">${inv.invoice_number ? '#' + inv.invoice_number : ''} ${inv.date ? '· ' + inv.date : ''}</p><div class="hl"></div></div>
      <div class="items">${pg.map(item => {
        const ph = itemPhotos[item.id] || []; const url = ph[0]?.url || null;
        if (detailed) {
          return `<div class="ic det">
            <div class="ip">${url ? `<img src="${url}"/>` : `<div class="np">No Image</div>`}</div>
            <div class="ii">
              <h2>${item.title || 'Untitled'}</h2>
              <table>
                <tr><td>Lot #</td><td><b>${item.lot_number || '—'}</b></td></tr>
                <tr><td>Auction Date</td><td>${item.date || inv.date || '—'}</td></tr>
                <tr><td>Invoice Date</td><td>${inv.date || '—'}</td></tr>
                <tr><td>Invoice To</td><td>${inv.auction_house || '—'}</td></tr>
                <tr><td>Location</td><td>${item.pickup_location || inv.pickup_location || '—'}</td></tr>
                <tr><td>Hammer</td><td>$${parseFloat(item.hammer_price||0).toFixed(2)}</td></tr>
                <tr><td>Premium</td><td>$${parseFloat(item.premium_amount||0).toFixed(2)}</td></tr>
                <tr><td>Tax</td><td>$${parseFloat(item.tax_amount||0).toFixed(2)}</td></tr>
                ${parseFloat(item.other_fees||0)>0?`<tr><td>${item.other_fees_desc||'Other Fees'}</td><td>$${parseFloat(item.other_fees).toFixed(2)}</td></tr>`:''}
                <tr><td><b>Total</b></td><td><b>$${parseFloat(item.total_cost||0).toFixed(2)}</b></td></tr>
              </table>
            </div>
          </div>`;
        } else {
          return `<div class="ic"><div class="ip">${url ? `<img src="${url}"/>` : `<div class="np">No Image</div>`}</div><div class="ii"><h2>${item.title || 'Untitled'}</h2>${item.lot_number ? `<p class="lot">Lot #${item.lot_number}</p>` : ''}</div></div>`;
        }
      }).join('')}</div>
      <div class="ft"><div class="hl"></div><p class="pn">Page ${pi + 1} of ${pages.length}</p></div>
    </div>`).join('');
    const detStyle = detailed ? `
      .ic.det{flex-direction:row;align-items:flex-start;gap:5mm;min-height:auto;max-height:58mm;padding:3mm;overflow:hidden}
      .det .ip{width:48mm;height:48mm;flex-shrink:0}
      .det .ii{flex:1;padding-left:2mm}
      .det .ii h2{font-size:11pt;margin-bottom:1.5mm}
      .det table{font-size:8.5pt;margin:0}.det td{padding:0.8mm 2mm;border-bottom:0.5px solid #eee}.det td:first-child{width:72px;color:#888}
      .items{gap:2mm}` : '';
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Print</title><style>@page{size:A4 portrait;margin:0}*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,'Segoe UI',Arial,sans-serif;background:#fff;color:#1a1a1a;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{width:210mm;min-height:297mm;max-height:297mm;padding:10mm 14mm;display:flex;flex-direction:column;overflow:hidden;page-break-after:always}.pb{page-break-before:always}.hdr{text-align:center;margin-bottom:4mm;flex-shrink:0}.hdr h1{font-size:15pt;font-weight:700;margin:2mm 0 1mm}.hdr .sub{font-size:9pt;color:#666}.hl{height:1px;background:linear-gradient(90deg,transparent,#333 15%,#333 85%,transparent);margin:2mm 0}.items{flex:1;display:flex;flex-direction:column;gap:4mm;overflow:hidden}.ic{border:1.5px solid #ddd;border-radius:3mm;padding:4mm;display:flex;align-items:center;gap:6mm;height:80mm;max-height:80mm;overflow:hidden}.ip{width:65mm;height:65mm;flex-shrink:0;border-radius:3mm;overflow:hidden;background:#f5f5f5;display:flex;align-items:center;justify-content:center}.ip img{width:100%;height:100%;object-fit:cover}.np{color:#aaa;font-size:10pt}.ii{flex:1;padding-left:3mm}.ii h2{font-size:14pt;font-weight:700;margin-bottom:2mm;line-height:1.3}.ii .lot{font-size:12pt;color:#444;font-weight:600;padding:1.5mm 4mm;background:#f0f0f0;border-radius:2mm;display:inline-block;margin-top:1mm}.ft{text-align:center;margin-top:auto;padding-top:2mm;flex-shrink:0}.ft .pn{font-size:8pt;color:#999}.inv-copy{border:2px solid #333;border-radius:4mm;padding:16mm;margin:16mm}.inv-copy h2{font-size:18pt;margin-bottom:6mm;text-align:center}.inv-copy table{width:100%;font-size:12pt;border-collapse:collapse}.inv-copy td{padding:3mm 4mm;border-bottom:1px solid #ddd}.inv-copy td:first-child{width:140px;color:#666}.billed-to{margin-top:8mm;padding-top:6mm;border-top:2px solid #333}.billed-to h3{font-size:13pt;margin-bottom:3mm;color:#666}.billed-to p{font-size:12pt;line-height:1.5}.orig-file{padding:8mm}.ofl{font-size:12pt;font-weight:700;margin-bottom:4mm;text-align:center;color:#666}${detStyle}</style></head><body>${invoiceCopyHtml}${pHTML}</body></html>`;
    const w = window.open('', '_blank', 'width=800,height=1000'); w.document.write(html); w.document.close(); setTimeout(() => { w.focus(); w.print(); }, 600);
  }, [itemPhotos, biz]);

  // ── Share with Customer — generates clean page with only name, photo, price ──
  const openCustomerShare = useCallback(async (item) => {
    setSharePrice(item.listing_price ? String(item.listing_price) : '');
    await loadPhotos(item.id);
    setModal({ type: 'customerShare', data: item });
  }, [loadPhotos]);

  const generateCustomerView = useCallback((item, price) => {
    const photos = (itemPhotos[item.id] || []).filter(p => p.url);
    const photosHtml = photos.length > 0
      ? photos.map(p => `<div class="ph"><img src="${p.url}"/></div>`).join('')
      : '<div class="noph">No Photos Available</div>';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${item.title}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,'Segoe UI',Arial,sans-serif;background:#f5f5f5;color:#1a1a1a;min-height:100vh;padding:16px}
.card{background:#fff;border-radius:20px;max-width:480px;margin:0 auto;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.08)}
.gallery{display:flex;flex-direction:column;gap:8px;padding:16px}
.ph{border-radius:12px;overflow:hidden}.ph img{width:100%;display:block;object-fit:cover;max-height:420px}
.noph{height:160px;background:#f0f0f0;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#999;margin:16px}
.info{padding:16px 20px 20px}h1{font-size:22px;font-weight:700;line-height:1.3;margin-bottom:8px}
.price{font-size:32px;font-weight:800;color:#FF6B00}.footer{padding:14px 20px;background:#fafafa;border-top:1px solid #eee;text-align:center;font-size:11px;color:#bbb}</style></head>
<body><div class="card"><div class="gallery">${photosHtml}</div><div class="info"><h1>${item.title}</h1><p class="price">$${parseFloat(price||0).toFixed(2)}</p></div><div class="footer">Auction Vault</div></div></body></html>`;
  }, [itemPhotos]);

  const buildShareText = useCallback((item, price) => {
    return `${item.title}\nPrice: $${parseFloat(price || 0).toFixed(2)}`;
  }, []);

  const setItemPurpose = useCallback(async (item, p) => { const st = ITEM_STATUSES.find(s=>s.id===p)||ITEM_STATUSES[0]; await db.updateItem(item.id, { purpose: p }); await db.addLifecycleEvent({ item_id: item.id, event: `Status: ${st.label}`, detail: `Changed to ${st.label}` }); await load(); if (p === 'returns' && !returnItems.find(r => r.id === item.id)) { await loadPhotos(item.id); setReturnItems(prev => [...prev, item]); } notify('ok', `${st.icon} ${st.label}`); }, [load, notify, returnItems, loadPhotos]);
  const setListingStatus = useCallback(async (item, st, platform, price) => { const u = { listing_status: st }; if (platform) u.listing_platform = platform; if (price) u.listing_price = price; if (st === 'live_listed') u.listed_at = new Date().toISOString(); await db.updateItem(item.id, u); await db.addLifecycleEvent({ item_id: item.id, event: st === 'live_listed' ? 'Listed Live' : st === 'pending_list' ? 'Pending List' : 'Unlisted', detail: platform || '' }); await load(); notify('ok', st === 'live_listed' ? 'Listed' : st === 'pending_list' ? 'Pending' : 'Unlisted'); }, [load, notify]);
  const handlePhoto = useCallback(async (id, e) => {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    const previews = files.map(f => ({ id: 'temp_' + Date.now() + Math.random(), url: URL.createObjectURL(f), file_name: f.name }));
    setItemPhotos(prev => ({ ...prev, [id]: [...(prev[id] || []), ...previews] }));
    for (const f of files) { try { await db.uploadPhoto(id, f); } catch (err) { console.error(err); } }
    await loadPhotos(id); notify('ok', `${files.length} photo(s) saved`);
  }, [notify, loadPhotos]);
  const handleDeletePhoto = useCallback(async (itemId, photo) => { if (!confirm('Delete photo?')) return; await db.deletePhoto(photo.id, photo.file_path); await loadPhotos(itemId); notify('ok', 'Deleted'); }, [loadPhotos, notify]);

  const addNote = useCallback(async (itemId, soldItemId) => { if (!noteForm.note.trim()) return; await db.insertNote({ item_id: itemId || null, sold_item_id: soldItemId || null, category: noteForm.category, note: noteForm.note.trim() }); await db.addLifecycleEvent({ item_id: itemId || undefined, sold_item_id: soldItemId || undefined, event: 'Note Added', detail: `${getCat(noteForm.category).label}: ${noteForm.note.trim().slice(0, 50)}` }); setNoteForm({ category: 'product_defect', note: '' }); if (itemId) await loadItemNotes(itemId, null); if (soldItemId) await loadItemNotes(null, soldItemId); await load(); notify('ok', 'Note added'); }, [noteForm, load, notify, loadItemNotes]);
  const resolveNote = useCallback(async (noteId, itemId, soldItemId) => { await db.resolveNote(noteId); if (itemId) await loadItemNotes(itemId, null); if (soldItemId) await loadItemNotes(null, soldItemId); await load(); notify('ok', 'Resolved'); }, [load, notify, loadItemNotes]);
  const deleteNoteById = useCallback(async (noteId, itemId, soldItemId) => { if (!confirm('Delete?')) return; await db.deleteNote(noteId); if (itemId) await loadItemNotes(itemId, null); if (soldItemId) await loadItemNotes(null, soldItemId); await load(); notify('ok', 'Deleted'); }, [load, notify, loadItemNotes]);

  // Quick sell — opens mini modal, moves to sales
  const handleQuickSell = useCallback(async () => {
    const item = modal?.data; if (!item || !quickSellData.price) return;
    const amt = parseFloat(quickSellData.price); if (isNaN(amt)) return;
    const del = parseFloat(quickSellData.deliveryCharge) || 0;
    const rcpt = `BOS-${Date.now().toString(36).toUpperCase()}`;
    const cost = parseFloat(item.total_cost); const profit = +(amt + del - cost).toFixed(2); const pct = cost > 0 ? +((profit / cost) * 100).toFixed(1) : 0;
    const si = await db.insertSoldItem({ item_id: item.id, invoice_id: item.invoice_id, lot_number: item.lot_number, title: item.title, description: item.description, quantity: item.quantity, hammer_price: item.hammer_price, premium_rate: item.premium_rate, tax_rate: item.tax_rate, premium_amount: item.premium_amount, subtotal: item.subtotal, tax_amount: item.tax_amount, total_cost: item.total_cost, auction_house: item.auction_house, date: item.date, pickup_location: item.pickup_location, payment_method: quickSellData.payMethod, sold_price: amt + del, sold_platform: '', sold_buyer: '', receipt_number: rcpt, profit, profit_pct: pct, bill_status: 'paid', paid_at: new Date().toISOString() });
    await db.deleteItem(item.id);
    const oldLc = await db.getLifecycle(item.id, null);
    if (oldLc.length) await db.addLifecycleEvents(oldLc.map(ev => ({ sold_item_id: si.id, event: ev.event, detail: ev.detail, created_at: ev.created_at })));
    await db.addLifecycleEvent({ sold_item_id: si.id, event: 'Sold', detail: `${fmt(amt)}${del > 0 ? ' + ' + fmt(del) + ' delivery' : ''} · ${quickSellData.payMethod.toUpperCase()} · ${rcpt}` });
    await load(); closeModal(); setQuickSellData({ price: '', payMethod: 'cash', deliveryCharge: '' });
    setTab('sales'); setSaleFilter('New Bill');
    notify('ok', `✅ Sold for ${fmt(amt + del)} · moved to Sales`);
  }, [modal, quickSellData, load, notify]);

  const handleListInStore = useCallback(async () => {
    const item = modal?.data; if (!item || !listStoreData.price) return;
    await db.updateItem(item.id, { selling_price: parseFloat(listStoreData.price), selling_description: listStoreData.description || '', purpose: 'for_sale' });
    await db.addLifecycleEvent({ item_id: item.id, event: 'Listed in Store', detail: `Price: $${listStoreData.price}` });
    await load(); closeModal(); setListStoreData({ price: '', description: '' });
    notify('ok', '🛒 Listed in store!');
  }, [modal, listStoreData, load, notify]);

  const handleSell = useCallback(async () => {
    const item = modal?.data; if (!item || !sf.amount) return; const amt = parseFloat(sf.amount); if (isNaN(amt)) return;
    const rcpt = `BOS-${Date.now().toString(36).toUpperCase()}`; const cost = parseFloat(item.total_cost); const profit = +(amt - cost).toFixed(2); const pct = cost > 0 ? +((profit / cost) * 100).toFixed(1) : 0; const lsf = { ...sf };
    const si = await db.insertSoldItem({ item_id: item.id, invoice_id: item.invoice_id, lot_number: item.lot_number, title: item.title, description: item.description, quantity: item.quantity, hammer_price: item.hammer_price, premium_rate: item.premium_rate, tax_rate: item.tax_rate, premium_amount: item.premium_amount, subtotal: item.subtotal, tax_amount: item.tax_amount, total_cost: item.total_cost, auction_house: item.auction_house, date: item.date, pickup_location: item.pickup_location, payment_method: item.payment_method, sold_price: amt, sold_platform: lsf.platform, sold_buyer: lsf.buyer, sold_buyer_email: lsf.buyerEmail, sold_buyer_phone: lsf.buyerPhone, receipt_number: rcpt, profit, profit_pct: pct, bill_status: lsf.billStatus, paid_at: lsf.billStatus === 'paid' ? new Date().toISOString() : null });
    await db.deleteItem(item.id); const oldLc = await db.getLifecycle(item.id, null);
    if (oldLc.length) await db.addLifecycleEvents(oldLc.map(ev => ({ sold_item_id: si.id, event: ev.event, detail: ev.detail, created_at: ev.created_at })));
    await db.addLifecycleEvent({ sold_item_id: si.id, event: 'Sold', detail: `${fmt(amt)} · ${lsf.billStatus === 'due' ? 'DUE' : 'PAID'} · ${rcpt}` });
    if (lsf.buyer && !customers.find(c => c.name === lsf.buyer)) await db.insertCustomer({ name: lsf.buyer, email: lsf.buyerEmail, phone: lsf.buyerPhone });
    await load(); closeModal(); notify('info', 'Generating Bill...');
    try { const seller = { name: biz.business_name, address: biz.address, phone: biz.phone, email: biz.email, hst: biz.hst }; const result = await generateBillAI({ billNumber: rcpt, items: [{ title: item.title, lot_number: item.lot_number, quantity: item.quantity || 1, price: amt }], buyer: { name: lsf.buyer || 'Walk-in', email: lsf.buyerEmail, phone: lsf.buyerPhone }, seller, billStatus: lsf.billStatus, taxRate: lsf.includeHst ? 0.13 : 0, date: new Date().toISOString() }); await db.updateSoldItem(si.id, { receipt_html: result.html }); setBillHtml(result.html); await load(); setModal({ type: 'billPreview', data: { ...si, receipt_html: result.html, sold_buyer: lsf.buyer, sold_buyer_email: lsf.buyerEmail, sold_buyer_phone: lsf.buyerPhone, receipt_number: rcpt, bill_status: lsf.billStatus } }); notify('ok', `Bill #${rcpt}`); } catch (err) { notify('err', err.message); }
  }, [modal, sf, customers, load, notify, biz]);

  const handleBillOfSale = useCallback(async () => {
    if (!billItems.length || !sf.buyer) return; const rcpt = `BOS-${Date.now().toString(36).toUpperCase()}`; const lsf = { ...sf }; const lbi = [...billItems]; const soldIds = [];
    for (const bi of lbi) { const item = items.find(i => i.id === bi.id); if (!item) continue; const amt = parseFloat(bi.sellPrice) || 0; const cost = parseFloat(item.total_cost); const profit = +(amt - cost).toFixed(2); const pct = cost > 0 ? +((profit / cost) * 100).toFixed(1) : 0; const si = await db.insertSoldItem({ item_id: item.id, invoice_id: item.invoice_id, lot_number: item.lot_number, title: item.title, description: item.description, quantity: item.quantity, hammer_price: item.hammer_price, premium_rate: item.premium_rate, tax_rate: item.tax_rate, premium_amount: item.premium_amount, subtotal: item.subtotal, tax_amount: item.tax_amount, total_cost: item.total_cost, auction_house: item.auction_house, date: item.date, sold_price: amt, sold_platform: lsf.platform, sold_buyer: lsf.buyer, sold_buyer_email: lsf.buyerEmail, sold_buyer_phone: lsf.buyerPhone, receipt_number: rcpt, profit, profit_pct: pct, bill_status: lsf.billStatus, paid_at: lsf.billStatus === 'paid' ? new Date().toISOString() : null }); await db.deleteItem(item.id); await db.addLifecycleEvent({ sold_item_id: si.id, event: 'Bill of Sale', detail: `${fmt(amt)} · ${rcpt}` }); soldIds.push(si); }
    if (lsf.buyer && !customers.find(c => c.name === lsf.buyer)) await db.insertCustomer({ name: lsf.buyer, email: lsf.buyerEmail, phone: lsf.buyerPhone });
    await load(); closeModal(); notify('info', 'Generating Bill...'); setBillBusy(true);
    try { const result = await generateBillAI({ billNumber: rcpt, items: lbi.map(bi => ({ title: bi.title, lot_number: bi.lot_number, quantity: bi.quantity || 1, price: parseFloat(bi.sellPrice) || 0 })), buyer: { name: lsf.buyer, email: lsf.buyerEmail, phone: lsf.buyerPhone }, seller: { name: biz.business_name, address: biz.address, phone: biz.phone, email: biz.email, hst: biz.hst }, billStatus: lsf.billStatus, taxRate: lsf.includeHst ? 0.13 : 0, date: new Date().toISOString() }); if (soldIds[0]) await db.updateSoldItem(soldIds[0].id, { receipt_html: result.html }); setBillHtml(result.html); setBillBusy(false); await load(); setModal({ type: 'billPreview', data: { receipt_number: rcpt, receipt_html: result.html, sold_buyer: lsf.buyer, sold_buyer_email: lsf.buyerEmail, sold_buyer_phone: lsf.buyerPhone, bill_status: lsf.billStatus, sold_price: lbi.reduce((s, i) => s + (parseFloat(i.sellPrice) || 0), 0) } }); notify('ok', `Bill #${rcpt} · ${lbi.length} items`); } catch (err) { setBillBusy(false); notify('err', err.message); }
  }, [billItems, sf, items, customers, load, notify, biz]);

  const viewBill = useCallback(async (si) => { if (si.receipt_html && si.receipt_html.length > 50 && si.receipt_html.startsWith('<')) { setBillHtml(si.receipt_html); setModal({ type: 'billPreview', data: si }); } else { setModal({ type: 'receipt', data: si }); setReceiptBusy(true); setReceiptHtml(''); try { const html = await generateReceiptAI(si, { name: biz.business_name, address: biz.address, phone: biz.phone, email: biz.email, hst: biz.hst }, { name: si.sold_buyer || 'Walk-in', email: si.sold_buyer_email || '', phone: si.sold_buyer_phone || '' }); setReceiptHtml(html); await db.updateSoldItem(si.id, { receipt_html: html }); } catch (err) { notify('err', err.message); closeModal(); } setReceiptBusy(false); } }, [biz, notify]);
  const markBillPaid = useCallback(async (si) => { await db.updateSoldItem(si.id, { bill_status: 'paid', paid_at: new Date().toISOString() }); await db.addLifecycleEvent({ sold_item_id: si.id, event: 'Paid', detail: fmt(si.sold_price) }); await load(); notify('ok', 'Paid'); }, [load, notify]);
  const openEditSold = useCallback((si) => { setSf({ amount: String(si.sold_price || ''), platform: si.sold_platform || '', buyer: si.sold_buyer || '', buyerEmail: si.sold_buyer_email || '', buyerPhone: si.sold_buyer_phone || '', billStatus: si.bill_status || 'paid', includeHst: true, listingUrl: '' }); setModal({ type: 'editSold', data: si }); }, []);
  const handleEditSold = useCallback(async () => { const si = modal?.data; if (!si) return; const amt = parseFloat(sf.amount); if (isNaN(amt)) return; const cost = parseFloat(si.total_cost); const profit = +(amt - cost).toFixed(2); const pct = cost > 0 ? +((profit / cost) * 100).toFixed(1) : 0; await db.updateSoldItem(si.id, { sold_price: amt, sold_platform: sf.platform, sold_buyer: sf.buyer, sold_buyer_email: sf.buyerEmail, sold_buyer_phone: sf.buyerPhone, bill_status: sf.billStatus, profit, profit_pct: pct, paid_at: sf.billStatus === 'paid' ? (si.paid_at || new Date().toISOString()) : null }); await db.addLifecycleEvent({ sold_item_id: si.id, event: 'Sale Edited', detail: `Price: ${fmt(amt)} · ${sf.billStatus.toUpperCase()}` }); await load(); closeModal(); notify('ok', 'Updated'); }, [modal, sf, load, notify]);
  const returnToInventory = useCallback(async (si) => { if (!confirm(`Move "${si.title}" back to inventory?`)) return; const newItem = await db.insertItems([{ invoice_id: si.invoice_id, lot_number: si.lot_number, title: si.title, description: si.description, quantity: si.quantity, hammer_price: si.hammer_price, premium_rate: si.premium_rate, tax_rate: si.tax_rate, premium_amount: si.premium_amount, subtotal: si.subtotal, tax_amount: si.tax_amount, total_cost: si.total_cost, auction_house: si.auction_house, date: si.date, pickup_location: si.pickup_location, payment_method: si.payment_method, status: 'in_inventory', purpose: 'for_sale', listing_status: 'none' }]); const oldLc = await db.getLifecycle(null, si.id); if (oldLc.length && newItem[0]) await db.addLifecycleEvents(oldLc.map(ev => ({ item_id: newItem[0].id, event: ev.event, detail: ev.detail, created_at: ev.created_at }))); if (newItem[0]) await db.addLifecycleEvent({ item_id: newItem[0].id, event: 'Returned to Inventory', detail: `Was sold for ${fmt(si.sold_price)} · ${si.receipt_number}` }); const { supabase } = await import('./utils/supabase'); await supabase.from('sold_items').delete().eq('id', si.id); await load(); notify('ok', `"${si.title}" returned`); }, [load, notify]);
  const handleLC = useCallback(async (item, isSold) => { setModal({ type: 'lc', data: item }); setLcEvents(await db.getLifecycle(isSold ? null : item.id, isSold ? item.id : null)); }, []);
  const handleEmail = useCallback(() => { if (!emailTo || !modal?.data) return; sendEmailFallback(emailTo, `Bill #${modal.data.receipt_number}`, buildReceiptText(modal.data, { name: biz.business_name, address: biz.address, phone: biz.phone })); notify('ok', 'Opening email'); closeModal(); }, [emailTo, modal, biz, notify]);

  const personalItems = items.filter(i => i.purpose === 'personal');
  const pendingItems = items.filter(i => i.listing_status === 'pending_list');
  const listedItems = items.filter(i => i.purpose === 'listed' || i.listing_status === 'live_listed');
  const dueBills = sold.filter(i => i.bill_status === 'due');
  const closedBills = sold.filter(i => i.bill_status === 'paid');
  const openNotes = allNotes.filter(n => !n.is_resolved);
  const resolvedNotes = allNotes.filter(n => n.is_resolved);
  const totalSpent = [...items, ...sold].reduce((s, i) => s + parseFloat(i.total_cost || 0), 0);
  const totalRev = sold.reduce((s, i) => s + parseFloat(i.sold_price || 0), 0);
  const totalProfit = sold.reduce((s, i) => s + parseFloat(i.profit || 0), 0);
  const invValue = items.reduce((s, i) => s + parseFloat(i.total_cost || 0), 0);
  const getItemStatus = (item) => item.purpose || 'for_sale';
  const getStatusInfo = (id) => ITEM_STATUSES.find(s => s.id === id) || ITEM_STATUSES[0];
  const filteredInv = () => { let arr = items; const f = invFilter; if (f === 'For Sale') arr = items.filter(i => (i.purpose || 'for_sale') === 'for_sale'); else if (f === 'Sold') arr = items.filter(i => i.purpose === 'sold'); else if (f === 'Listed') arr = items.filter(i => i.purpose === 'listed' || i.listing_status === 'live_listed'); else if (f === 'Booked') arr = items.filter(i => i.purpose === 'booked'); else if (f === 'Personal') arr = personalItems; else if (f === 'Damaged') arr = items.filter(i => i.purpose === 'damaged'); else if (f === 'Returns') arr = items.filter(i => i.purpose === 'returns'); if (!search) return arr; const t = search.toLowerCase(); return arr.filter(i => [i.title, i.description, i.auction_house, i.lot_number].some(f => f?.toLowerCase?.().includes(t))); };
  // Check if all items of an invoice have photos
  const invoicePhotosComplete = (invId) => { const invItems = items.filter(i => i.invoice_id === invId); if (invItems.length === 0) return null; return invItems.every(i => (itemPhotos[i.id] || []).length > 0); };
  const getItemInvoice = (item) => invoices.find(inv => inv.id === item.invoice_id);
  const openProductDetail = useCallback(async (item) => { await loadPhotos(item.id); setModal({ type: 'productDetail', data: item }); }, [loadPhotos]);
  // Returns
  const searchReturnable = () => { if (!returnSearch.trim()) return []; const q = returnSearch.toLowerCase(); return [...items.filter(i => [i.title, i.lot_number, i.auction_house].some(f => f?.toLowerCase?.().includes(q))).map(i => ({ ...i, _src: 'item' })), ...sold.filter(i => [i.title, i.lot_number, i.receipt_number].some(f => f?.toLowerCase?.().includes(q))).map(i => ({ ...i, _src: 'sold' }))]; };
  const addToReturn = useCallback(async (item) => { if (returnItems.find(r => r.id === item.id)) { notify('err', 'Already added'); return; } await loadPhotos(item.id); setReturnItems(prev => [...prev, item]); notify('ok', `Added: ${item.title}`); }, [returnItems, notify, loadPhotos]);
  const removeFromReturn = (id) => { setReturnItems(prev => prev.filter(r => r.id !== id)); setReturnReasons(prev => { const n = { ...prev }; delete n[id]; return n; }); setReturnPhotos(prev => { const n = { ...prev }; delete n[id]; return n; }); };
  const handleReturnPhoto = useCallback(async (itemId, e) => { const files = Array.from(e.target.files || []); if (!files.length) return; const urls = files.map(f => ({ id: 'rp_' + Date.now() + Math.random(), url: URL.createObjectURL(f), file_name: f.name, isReturn: true })); setReturnPhotos(prev => ({ ...prev, [itemId]: [...(prev[itemId] || []), ...urls] })); notify('ok', `${files.length} return photo(s) added`); }, [notify]);
  const saveReturnRequest = useCallback(() => {
    if (!returnItems.length) return;
    const cluster = { id: uid(), date: new Date().toISOString(), items: returnItems.map(item => ({ id: item.id, title: item.title, lot_number: item.lot_number, auction_house: item.auction_house, invoice_id: item.invoice_id, hammer_price: item.hammer_price, premium_amount: item.premium_amount, tax_amount: item.tax_amount, total_cost: item.total_cost, date: item.date, pickup_location: item.pickup_location, reason: returnReasons[item.id] || '', returnPhotoCount: (returnPhotos[item.id] || []).length })) };
    const updated = [cluster, ...savedReturns];
    setSavedReturns(updated);
    try { localStorage.setItem('av_returns', JSON.stringify(updated)); } catch {}
    setReturnItems([]); setReturnReasons({}); setReturnPhotos({});
    notify('ok', `✅ Return request saved (${cluster.items.length} items)`);
  }, [returnItems, returnReasons, returnPhotos, savedReturns, notify]);
  const deleteReturnRequest = (id) => { if (!confirm('Delete this saved return?')) return; const updated = savedReturns.filter(r => r.id !== id); setSavedReturns(updated); try { localStorage.setItem('av_returns', JSON.stringify(updated)); } catch {} notify('ok', 'Deleted'); };

  const generateReturnPDF = useCallback(async (detailed = true, includeInvoiceCopy = false) => {
    if (!returnItems.length) return;
    notify('info', 'Generating PDF...');
    let invoiceCopyHtml = '';
    if (includeInvoiceCopy) {
      const invIds = [...new Set(returnItems.map(i => i.invoice_id).filter(Boolean))];
      for (const invId of invIds) {
        const inv = invoices.find(i => i.id === invId); if (!inv) continue;
        let origFileHtml = '';
        if (inv.file_path) { try { const url = await db.getInvoiceFileUrl(inv.file_path); if (url) { origFileHtml = `<div class="page pb"><div class="orig-file"><p class="ofl">Original Invoice Document</p><img src="${url}" style="width:100%;max-height:265mm;object-fit:contain;" onerror="this.parentElement.innerHTML='<p style=text-align:center;color:#999;padding:20mm>Invoice file could not be loaded. View in app.</p>'"/></div></div>`; } } catch(e){} }
        invoiceCopyHtml += `<div class="page${invoiceCopyHtml?' pb':''}"><div class="inv-copy"><h2>Invoice — ${inv.auction_house||''}</h2><table>
          <tr><td>Invoice #</td><td>${inv.invoice_number||''}</td></tr><tr><td>Date</td><td>${inv.date||''}</td></tr><tr><td>Payment</td><td>${inv.payment_method||''} · ${inv.payment_status||''}</td></tr><tr><td>Location</td><td>${inv.pickup_location||''}</td></tr><tr><td>Items</td><td>${inv.item_count||''}</td></tr><tr><td>Lot Total</td><td>$${parseFloat(inv.lot_total||0).toFixed(2)}</td></tr><tr><td>Premium</td><td>$${parseFloat(inv.premium_total||0).toFixed(2)}</td></tr><tr><td>Tax</td><td>$${parseFloat(inv.tax_total||0).toFixed(2)}</td></tr>${parseFloat(inv.other_fees_total||0)>0?`<tr><td>${inv.other_fees_labels||'Other Fees'}</td><td>$${parseFloat(inv.other_fees_total).toFixed(2)}</td></tr>`:''}<tr><td><b>Grand Total</b></td><td><b>$${parseFloat(inv.grand_total||0).toFixed(2)}</b></td></tr>
          </table><div class="billed-to"><h3>Billed To</h3><p><b>${biz.business_name||'—'}</b></p><p>${biz.address||''}</p><p>${biz.phone||''} ${biz.email?'· '+biz.email:''}</p>${biz.hst?`<p>HST: ${biz.hst}</p>`:''}</div></div></div>${origFileHtml}`;
      }
    }
    const baseStyle = `@page{size:A4 portrait;margin:0}*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,Arial,sans-serif;background:#fff;color:#1a1a1a;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{width:210mm;min-height:297mm;padding:12mm 16mm;display:flex;flex-direction:column}.pb{page-break-before:always}.hdr{text-align:center;margin-bottom:5mm}.hdr h1{font-size:16pt;font-weight:700;margin:2mm 0 1mm}.hdr .sub{font-size:9pt;color:#666}.hl{height:1.5px;background:linear-gradient(90deg,transparent,#333 15%,#333 85%,transparent);margin:2mm 0}.ft{text-align:center;margin-top:3mm}.ft .pn{font-size:8pt;color:#999}.inv-copy{border:2px solid #333;border-radius:4mm;padding:12mm;margin:12mm}.inv-copy h2{font-size:16pt;margin-bottom:4mm;text-align:center}.inv-copy table{width:100%;font-size:11pt;border-collapse:collapse}.inv-copy td{padding:2mm 3mm;border-bottom:1px solid #eee}.inv-copy td:first-child{width:130px;color:#666}.billed-to{margin-top:6mm;padding-top:4mm;border-top:2px solid #333}.billed-to h3{font-size:12pt;margin-bottom:2mm;color:#666}.billed-to p{font-size:11pt;line-height:1.4}.orig-file{padding:8mm}.ofl{font-size:12pt;font-weight:700;margin-bottom:4mm;text-align:center;color:#666}`;
    if (!detailed) {
      const perPage = 4; const pages = []; for (let i = 0; i < returnItems.length; i += perPage) pages.push(returnItems.slice(i, i + perPage));
      const pHTML = pages.map((pg, pi) => `<div class="page pb"><div class="hdr"><div class="hl"></div><h1>Return Report</h1><p class="sub">${returnItems.length} item(s) · ${new Date().toLocaleDateString('en-CA')}</p><div class="hl"></div></div><div class="items">${pg.map(item => { const ph = itemPhotos[item.id] || []; const url = ph[0]?.url || null; const reason = returnReasons[item.id] || ''; return `<div class="ic"><div class="ip">${url ? `<img src="${url}"/>` : `<div class="np">No Image</div>`}</div><div class="ii"><h2>${item.title || 'Untitled'}</h2>${item.lot_number ? `<p class="lot">Lot #${item.lot_number}</p>` : ''}${reason ? `<p class="rsn">Reason: ${reason}</p>` : ''}</div></div>`; }).join('')}</div><div class="ft"><div class="hl"></div><p class="pn">Page ${pi + 1} of ${pages.length}</p></div></div>`).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Return Report</title><style>${baseStyle}.items{flex:1;display:flex;flex-direction:column;gap:3mm}.ic{border:1.5px solid #ddd;border-radius:3mm;padding:3mm;display:flex;align-items:center;gap:4mm;min-height:50mm}.ip{width:42mm;height:42mm;flex-shrink:0;border-radius:2mm;overflow:hidden;background:#f5f5f5;display:flex;align-items:center;justify-content:center}.ip img{width:100%;height:100%;object-fit:cover}.np{color:#aaa;font-size:9pt}.ii{flex:1}.ii h2{font-size:12pt;font-weight:700;margin-bottom:1mm;line-height:1.3}.ii .lot{font-size:10pt;color:#444;font-weight:600;padding:1mm 3mm;background:#f0f0f0;border-radius:2mm;display:inline-block}.ii .rsn{font-size:9pt;color:#C2410C;margin-top:1.5mm;font-style:italic}</style></head><body>${invoiceCopyHtml}${pHTML}</body></html>`;
      const w = window.open('', '_blank', 'width=800,height=1000'); w.document.write(html); w.document.close(); setTimeout(() => { w.focus(); w.print(); }, 600); return;
    }
    const ihtml = returnItems.map(item => { const op = (itemPhotos[item.id] || []).filter(p => p.url); const rp = (returnPhotos[item.id] || []).filter(p => p.url); const inv = getItemInvoice(item); const reason = returnReasons[item.id] || '';
      return `<div class="item"><h2>${item.title}</h2><table><tr><td><b>Lot #</b></td><td>${item.lot_number || '—'}</td></tr><tr><td><b>Invoice #</b></td><td>${inv?.invoice_number || '—'}</td></tr><tr><td><b>Vendor</b></td><td>${item.auction_house || '—'}</td></tr><tr><td><b>Date</b></td><td>${item.date || '—'}</td></tr><tr><td><b>Location</b></td><td>${item.pickup_location || inv?.pickup_location || '—'}</td></tr><tr><td><b>Hammer</b></td><td>$${parseFloat(item.hammer_price||0).toFixed(2)}</td></tr><tr><td><b>Premium</b></td><td>$${parseFloat(item.premium_amount||0).toFixed(2)}</td></tr><tr><td><b>Tax</b></td><td>$${parseFloat(item.tax_amount||0).toFixed(2)}</td></tr>${parseFloat(item.other_fees||0)>0?`<tr><td><b>${item.other_fees_desc||'Other Fees'}</b></td><td>$${parseFloat(item.other_fees).toFixed(2)}</td></tr>`:''}<tr><td><b>Total</b></td><td><b>$${parseFloat(item.total_cost||0).toFixed(2)}</b></td></tr></table>${reason ? `<div class="reason"><b>Reason:</b> ${reason}</div>` : ''}${op.length > 0 ? `<p class="pl">Original Photos (${op.length})</p><div class="photos">${op.map(p => `<img src="${p.url}"/>`).join('')}</div>` : ''}${rp.length > 0 ? `<p class="pl" style="color:#DC2626">Return Photos (${rp.length})</p><div class="photos">${rp.map(p => `<img src="${p.url}"/>`).join('')}</div>` : ''}</div>`; }).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Return Report</title><style>@page{size:A4 portrait;margin:15mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,Arial,sans-serif;color:#1a1a1a;-webkit-print-color-adjust:exact;print-color-adjust:exact}h1{font-size:20pt;text-align:center;margin-bottom:4mm;padding-bottom:3mm;border-bottom:2px solid #333}.meta{text-align:center;color:#666;font-size:10pt;margin-bottom:8mm}.item{border:1.5px solid #ddd;border-radius:4mm;padding:5mm;margin-bottom:6mm;page-break-inside:avoid}.item h2{font-size:14pt;margin-bottom:3mm}table{width:100%;font-size:11pt;border-collapse:collapse;margin-bottom:3mm}td{padding:2mm 3mm;border-bottom:1px solid #eee}td:first-child{width:120px;color:#666}.reason{background:#FFF7ED;border:1px solid #FB923C;border-radius:2mm;padding:3mm;margin:3mm 0;font-size:11pt}.pl{font-size:10pt;font-weight:600;margin:3mm 0 2mm}.photos{display:flex;gap:3mm;flex-wrap:wrap}.photos img{width:45mm;height:45mm;object-fit:cover;border-radius:2mm;border:1px solid #ddd}.inv-copy{border:2px solid #333;border-radius:4mm;padding:12mm;margin-bottom:8mm;page-break-after:always}.inv-copy h2{font-size:16pt;margin-bottom:4mm;text-align:center}.inv-copy table{width:100%;font-size:11pt;border-collapse:collapse}.inv-copy td{padding:2mm 3mm;border-bottom:1px solid #eee}.inv-copy td:first-child{width:130px;color:#666}.billed-to{margin-top:6mm;padding-top:4mm;border-top:2px solid #333}.billed-to h3{font-size:12pt;margin-bottom:2mm;color:#666}.billed-to p{font-size:11pt;line-height:1.4}.orig-file{padding:8mm}.ofl{font-size:12pt;font-weight:700;margin-bottom:4mm;text-align:center;color:#666}</style></head><body>${invoiceCopyHtml}<h1>Return Report</h1><p class="meta">${returnItems.length} item(s) · ${new Date().toLocaleDateString('en-CA')}</p>${ihtml}</body></html>`;
    const w = window.open('', '_blank', 'width=800,height=1000'); w.document.write(html); w.document.close(); setTimeout(() => { w.focus(); w.print(); }, 600);
  }, [returnItems, returnReasons, itemPhotos, returnPhotos, getItemInvoice, invoices, biz, notify]);
  const noteItemName = (note) => { if (note.item_id) { const it = items.find(i => i.id === note.item_id); return it ? it.title : 'Unknown'; } if (note.sold_item_id) { const si = sold.find(i => i.id === note.sold_item_id); return si ? si.title : 'Sold item'; } return 'Unknown'; };

  // ═══ RENDER ═══
  if (auth === 'loading') return <div style={S.center}><div style={S.spin}/></div>;
  if (auth === 'login') return (
    <div style={S.center}><div style={{width:'100%',maxWidth:380,padding:'0 28px'}}>
      <div style={{textAlign:'center',marginBottom:32}}><div style={{width:64,height:64,borderRadius:20,background:'var(--accent)',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:30,marginBottom:14}}>⚡</div><h1 style={{fontSize:26,fontWeight:800}}>Auction Vault</h1><p style={{fontSize:14,color:'var(--text-muted)',marginTop:4}}>Track, sell, profit.</p></div>
      {authErr && <div style={{background:'var(--red-light)',color:'var(--red)',padding:'10px 14px',borderRadius:10,fontSize:13,marginBottom:12,textAlign:'center'}}>{authErr}</div>}
      <input style={S.inp} type="email" placeholder="Email" value={af.email} onChange={e=>setAf({...af,email:e.target.value})}/>
      <input style={{...S.inp,marginTop:10}} type="password" placeholder="Password" value={af.password} onChange={e=>setAf({...af,password:e.target.value})} onKeyDown={e=>e.key==='Enter'&&handleAuth()}/>
      <button style={{...S.btn1,width:'100%',marginTop:18}} onClick={handleAuth} disabled={authBusy}>{authBusy?'...':af.mode==='login'?'Sign In':'Create Account'}</button>
      <button style={{background:'none',border:'none',color:'var(--accent)',fontSize:14,marginTop:16,width:'100%',textAlign:'center',fontFamily:'var(--font)',cursor:'pointer'}} onClick={()=>setAf({...af,mode:af.mode==='login'?'signup':'login'})}>{af.mode==='login'?"Don't have an account? Sign up":'Already have an account? Sign in'}</button>
    </div></div>
  );

  return (
    <div style={S.shell}>
      {toast&&<div className="fade-up" style={{...S.toast,background:toast.t==='ok'?'var(--green)':toast.t==='err'?'var(--red)':'var(--accent)'}}>{toast.t==='info'&&<div style={S.miniSpin}/>}{toast.m}</div>}
      {billBusy&&<div style={S.fullOL}><div style={S.spin}/><p style={{color:'#fff',marginTop:12}}>Generating Bill...</p></div>}

      {/* Upload busy overlay */}
      {uploadBusy&&<div style={S.fullOL}><div style={S.spin}/><p style={{color:'#fff',marginTop:12,fontSize:15,fontWeight:600}}>Analyzing Invoice...</p><p style={{color:'rgba(255,255,255,.6)',fontSize:12,marginTop:4}}>This may take up to 30 seconds</p></div>}

      <main style={S.main}>
        {/* HOME — P&L Dashboard */}
        {tab==='home'&&(()=>{
          const bucketCalc=(filter)=>{const arr=filter==='all'?items:items.filter(i=>(i.purpose||'for_sale')===filter);return{count:arr.length,value:arr.reduce((s,i)=>s+parseFloat(i.total_cost||0),0)};};
          const bk={forSale:bucketCalc('for_sale'),sold:bucketCalc('sold'),listed:bucketCalc('listed'),booked:bucketCalc('booked'),personal:bucketCalc('personal'),damaged:bucketCalc('damaged'),returns:bucketCalc('returns')};
          const soldRev=sold.reduce((s,i)=>s+parseFloat(i.sold_price||0),0);
          const soldCost=sold.reduce((s,i)=>s+parseFloat(i.total_cost||0),0);
          const soldProfit=sold.reduce((s,i)=>s+parseFloat(i.profit||0),0);
          const totalInvested=invoices.reduce((s,i)=>s+parseFloat(i.grand_total||0),0);
          return<>
          <div style={S.hdr}><p style={{fontSize:13,color:'var(--text-muted)',letterSpacing:.3}}>DASHBOARD</p><h1 style={{fontSize:24,fontWeight:800}}>Auction Vault</h1></div>

          {/* P&L Summary */}
          <div style={{...S.card,padding:'16px',marginBottom:12,background:'linear-gradient(135deg,#1a1a2e,#16213e)',color:'#fff',borderRadius:16}}>
            <p style={{fontSize:11,opacity:.7,marginBottom:4}}>TOTAL INVESTED</p>
            <p style={{fontSize:28,fontWeight:800,marginBottom:8}}>{fmt(totalInvested)}</p>
            <div style={{display:'flex',gap:12}}>
              <div><p style={{fontSize:10,opacity:.6}}>Revenue</p><p style={{fontSize:16,fontWeight:700,color:'#4ade80'}}>{fmt(soldRev)}</p></div>
              <div><p style={{fontSize:10,opacity:.6}}>Profit</p><p style={{fontSize:16,fontWeight:700,color:soldProfit>=0?'#4ade80':'#f87171'}}>{soldProfit>=0?'+':''}{fmt(soldProfit)}</p></div>
              <div><p style={{fontSize:10,opacity:.6}}>ROI</p><p style={{fontSize:16,fontWeight:700,color:soldProfit>=0?'#4ade80':'#f87171'}}>{soldCost>0?((soldProfit/soldCost)*100).toFixed(1):'0'}%</p></div>
              <div><p style={{fontSize:10,opacity:.6}}>In Stock</p><p style={{fontSize:16,fontWeight:700}}>{fmt(invValue)}</p></div>
            </div>
          </div>

          {/* Bucket breakdown — clickable */}
          <p style={S.secT}>Portfolio Breakdown</p>
          <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8,marginBottom:14}}>
            {ITEM_STATUSES.map(st=>{const b=st.id==='for_sale'?bk.forSale:st.id==='sold'?bk.sold:st.id==='listed'?bk.listed:st.id==='booked'?bk.booked:st.id==='personal'?bk.personal:st.id==='damaged'?bk.damaged:bk.returns;
              return<div key={st.id} style={{...S.card,padding:'12px 14px',borderLeft:`3px solid ${st.color}`,cursor:'pointer',opacity:b.count>0?1:.5}} onClick={()=>{setTab('inventory');setInvFilter(st.label);}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                  <span style={{fontSize:12,fontWeight:700,color:st.color}}>{st.icon} {st.label}</span>
                  <span style={{fontSize:10,padding:'2px 6px',borderRadius:10,background:st.bg,color:st.color,fontWeight:700}}>{b.count}</span>
                </div>
                <p style={{fontSize:16,fontWeight:800,color:'var(--text)'}}>{fmt(b.value)}</p>
                {totalInvested>0&&<div style={{height:3,background:'var(--border)',borderRadius:2,marginTop:4,overflow:'hidden'}}><div style={{height:'100%',background:st.color,borderRadius:2,width:`${Math.min((b.value/totalInvested)*100,100)}%`}}/></div>}
              </div>;
            })}
            {/* Sold (moved to sales) */}
            <div style={{...S.card,padding:'12px 14px',borderLeft:'3px solid var(--green)',cursor:'pointer',gridColumn:'1/-1'}} onClick={()=>setTab('sales')}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                <span style={{fontSize:12,fontWeight:700,color:'var(--green)'}}>💰 Sold & Moved to Sales</span>
                <span style={{fontSize:10,padding:'2px 6px',borderRadius:10,background:'var(--green-light)',color:'var(--green)',fontWeight:700}}>{sold.length}</span>
              </div>
              <div style={{display:'flex',gap:16}}>
                <div><p style={{fontSize:10,color:'var(--text-muted)'}}>Revenue</p><p style={{fontSize:15,fontWeight:800,color:'var(--green)'}}>{fmt(soldRev)}</p></div>
                <div><p style={{fontSize:10,color:'var(--text-muted)'}}>Cost</p><p style={{fontSize:15,fontWeight:700}}>{fmt(soldCost)}</p></div>
                <div><p style={{fontSize:10,color:'var(--text-muted)'}}>Profit</p><p style={{fontSize:15,fontWeight:800,color:soldProfit>=0?'var(--green)':'var(--red)'}}>{soldProfit>=0?'+':''}{fmt(soldProfit)}</p></div>
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:16}}>
            <label role="button" style={{...S.qAct,opacity:uploadBusy?.5:1,pointerEvents:uploadBusy?'none':'auto'}}><input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" multiple onChange={handleUpload} style={{display:'none'}}/><span style={{fontSize:28,marginBottom:4}}>{uploadBusy?'⏳':'📄'}</span><span style={{fontSize:13,fontWeight:700}}>{uploadBusy?'Analyzing...':'Upload'}</span></label>
            <div style={S.qAct} onClick={()=>{setTab('sales');setSaleFilter('New Bill');setModal({type:'billOfSale'});}}><span style={{fontSize:28,marginBottom:4}}>🧾</span><span style={{fontSize:13,fontWeight:700}}>Bill of Sale</span></div>
            <div style={S.qAct} onClick={()=>window.open('/store','_blank')}><span style={{fontSize:28,marginBottom:4}}>🛒</span><span style={{fontSize:13,fontWeight:700}}>My Store</span></div>
          </div>

          {/* Alerts */}
          {openNotes.length>0&&<div style={{...S.card,marginBottom:10,background:'#FEF3C7',border:'1px solid #F59E0B',padding:'14px 16px',display:'flex',justifyContent:'space-between',alignItems:'center'}}><div><p style={{fontSize:14,fontWeight:700,color:'#92400E'}}>⚠️ {openNotes.length} Open Issue{openNotes.length>1?'s':''}</p></div><button style={{...S.chip,background:'#F59E0B',color:'#fff',fontWeight:700}} onClick={()=>{setTab('account');setIssueFilter('Open');}}>View</button></div>}
          {dueBills.length>0&&<div style={{...S.card,marginBottom:10,background:'var(--red-light)',border:'1px solid var(--red)',padding:'14px 16px',display:'flex',justifyContent:'space-between',alignItems:'center'}}><div><p style={{fontSize:14,fontWeight:700,color:'var(--red)'}}>💸 {dueBills.length} Unpaid</p><p style={{fontSize:12,color:'var(--text-secondary)'}}>{fmt(dueBills.reduce((s,i)=>s+parseFloat(i.sold_price||0),0))}</p></div><button style={{...S.chip,background:'var(--red)',color:'#fff',fontWeight:700}} onClick={()=>{setTab('sales');setSaleFilter('Due');}}>View</button></div>}
          {returnItems.length>0&&<div style={{...S.card,marginBottom:10,background:'#FFF7ED',border:'1px solid #C2410C',padding:'14px 16px',display:'flex',justifyContent:'space-between',alignItems:'center'}}><div><p style={{fontSize:14,fontWeight:700,color:'#C2410C'}}>↩️ {returnItems.length} Pending Return{returnItems.length>1?'s':''}</p></div><button style={{...S.chip,background:'#C2410C',color:'#fff',fontWeight:700}} onClick={()=>setTab('returns')}>View</button></div>}

          {/* Recent invoices */}
          {invoices.length>0&&<>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}><p style={S.secT}>Recent Invoices</p><button style={{...S.chip,fontSize:12,fontWeight:600,color:'var(--accent)'}} onClick={()=>setTab('invoices')}>View All →</button></div>
            {invoices.slice(0,3).map((inv,i)=><div key={inv.id} className="fade-up" style={{...S.card,marginBottom:8,animationDelay:`${i*30}ms`,cursor:'pointer'}} onClick={()=>openInvoice(inv)}><div style={{display:'flex',gap:12,padding:'14px 16px',alignItems:'center'}}><div style={{width:42,height:42,borderRadius:12,background:inv.payment_status==='Paid'?'var(--green-light)':'var(--red-light)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontSize:18}}>{inv.payment_status==='Paid'?'✅':'⏳'}</div><div style={{flex:1,minWidth:0}}><p style={{fontSize:15,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{inv.auction_house}</p><p style={{fontSize:12,color:'var(--text-muted)'}}>{fmtDate(inv.date)} · {inv.item_count} items</p></div><div style={{textAlign:'right'}}><p style={{fontSize:16,fontWeight:700,color:'var(--accent)'}}>{fmt(inv.grand_total)}</p><Tag text={inv.payment_status||'Due'} ok={inv.payment_status==='Paid'}/></div></div></div>)}
          </>}
        </>;})()}

        {/* INVOICES — ALL invoices with vendor filter + sort + search */}
        {tab==='invoices'&&<>
          <div style={S.hdr}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div><h1 style={{fontSize:24,fontWeight:800}}>Invoices</h1><p style={{fontSize:13,color:'var(--text-muted)'}}>{invoices.length} total · {fmt(invoices.reduce((s,i)=>s+parseFloat(i.grand_total||0),0))}</p></div>
              <label role="button" style={{...S.btn1,padding:'10px 16px',fontSize:13,opacity:uploadBusy?.5:1}}><input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" multiple onChange={handleUpload} style={{display:'none'}}/>{uploadBusy?'⏳ Analyzing...':'📄 Upload'}</label>
            </div>
          </div>
          {/* Status pills */}
          <div style={S.pills}>{['All','Paid','Due'].map(f=><button key={f} style={{...S.pill,...(invStatusFilter===f?S.pillOn:{})}} onClick={()=>setInvStatusFilter(f)}>{f}{f==='Due'?` (${invoices.filter(i=>i.payment_status!=='Paid').length})`:f==='Paid'?` (${invoices.filter(i=>i.payment_status==='Paid').length})`:` (${invoices.length})`}</button>)}</div>
          {/* Vendor filter + Sort row */}
          <div style={{display:'flex',gap:8,marginBottom:10}}>
            <select style={{...S.inp,flex:1,padding:'8px 10px',fontSize:13,appearance:'auto'}} value={invVendor} onChange={e=>setInvVendor(e.target.value)}>
              <option value="All">All Vendors</option>
              {[...new Set(invoices.map(i=>i.auction_house).filter(Boolean))].sort().map(v=><option key={v} value={v}>{v}</option>)}
            </select>
            <select style={{...S.inp,width:130,padding:'8px 10px',fontSize:13,appearance:'auto'}} value={invSort} onChange={e=>setInvSort(e.target.value)}>
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="highest">Highest $</option>
              <option value="lowest">Lowest $</option>
              <option value="name">A → Z</option>
            </select>
          </div>
          {/* Search */}
          <input style={{...S.inp,marginBottom:12}} placeholder="Search auction house, invoice #..." value={invSearch} onChange={e=>setInvSearch(e.target.value)}/>
          {/* Invoice list */}
          {(()=>{
            let list = [...invoices];
            if(invStatusFilter==='Paid') list=list.filter(i=>i.payment_status==='Paid');
            if(invStatusFilter==='Due') list=list.filter(i=>i.payment_status!=='Paid');
            if(invVendor!=='All') list=list.filter(i=>i.auction_house===invVendor);
            if(invSearch){const q=invSearch.toLowerCase(); list=list.filter(i=>[i.auction_house,i.invoice_number,i.event_description].some(f=>f?.toLowerCase?.().includes(q)));}
            if(invSort==='newest') list.sort((a,b)=>new Date(b.date||b.created_at)-new Date(a.date||a.created_at));
            if(invSort==='oldest') list.sort((a,b)=>new Date(a.date||a.created_at)-new Date(b.date||b.created_at));
            if(invSort==='highest') list.sort((a,b)=>parseFloat(b.grand_total||0)-parseFloat(a.grand_total||0));
            if(invSort==='lowest') list.sort((a,b)=>parseFloat(a.grand_total||0)-parseFloat(b.grand_total||0));
            if(invSort==='name') list.sort((a,b)=>(a.auction_house||'').localeCompare(b.auction_house||''));
            if(list.length===0) return <Empty text={invSearch||invVendor!=='All'?'No matching invoices':'No invoices yet. Upload one!'}/>;
            return list.map((inv,i)=>{const pc=invoicePhotosComplete(inv.id);return <div key={inv.id} className="fade-up" style={{...S.card,marginBottom:8,animationDelay:`${i*25}ms`,cursor:'pointer',borderLeft:pc===true?'3px solid var(--green)':pc===false?'3px solid var(--red)':'none'}} onClick={()=>openInvoice(inv)}>
              <div style={{display:'flex',gap:12,padding:'14px 16px',alignItems:'center'}}>
                <div style={{width:44,height:44,borderRadius:12,background:pc===true?'var(--green-light)':pc===false?'var(--red-light)':'var(--bg-surface)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontSize:18}}>{pc===true?'✅':pc===false?'📷':'📄'}</div>
                <div style={{flex:1,minWidth:0}}>
                  <p style={{fontSize:15,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{inv.auction_house}</p>
                  <p style={{fontSize:12,color:'var(--text-muted)'}}>{fmtDate(inv.date)} · #{inv.invoice_number} · {inv.item_count} items</p>
                  {pc===false&&<span style={{fontSize:10,color:'var(--red)',fontWeight:600}}>⚠ Photos missing</span>}
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                  <p style={{fontSize:16,fontWeight:700,color:'var(--accent)'}}>{fmt(inv.grand_total)}</p>
                  <Tag text={inv.payment_status||'Due'} ok={inv.payment_status==='Paid'}/>
                </div>
              </div>
            </div>;});
          })()}
        </>}

        {/* INVENTORY */}
        {tab==='inventory'&&<>
          <div style={S.hdr}><h1 style={{fontSize:24,fontWeight:800}}>Inventory</h1><p style={{fontSize:13,color:'var(--text-muted)'}}>{items.length} items · {fmt(invValue)}</p></div>
          {/* Bucket summary bar */}
          <div style={{display:'flex',gap:4,overflowX:'auto',marginBottom:10,paddingBottom:2}}>
            {ITEM_STATUSES.map(st=>{const arr=items.filter(i=>(i.purpose||'for_sale')===st.id);const val=arr.reduce((s,i)=>s+parseFloat(i.total_cost||0),0);return arr.length>0&&<div key={st.id} style={{background:st.bg,borderRadius:8,padding:'4px 10px',flexShrink:0,textAlign:'center',cursor:'pointer',border:invFilter===st.label?`2px solid ${st.color}`:'2px solid transparent'}} onClick={()=>setInvFilter(invFilter===st.label?'All':st.label)}>
              <p style={{fontSize:9,fontWeight:700,color:st.color}}>{st.icon} {arr.length}</p>
              <p style={{fontSize:11,fontWeight:700,color:st.color}}>{fmt(val)}</p>
            </div>;})}
          </div>
          <div style={S.pills}>{INV_FILTERS.map(f=>{const cnt=f==='All'?items.length:items.filter(i=>{const p=i.purpose||'for_sale';const lbl=ITEM_STATUSES.find(s=>s.id===p)?.label;return lbl===f||(f==='For Sale'&&p==='for_sale');}).length;return<button key={f} style={{...S.pill,...(invFilter===f?S.pillOn:{})}} onClick={()=>setInvFilter(f)}>{f}{cnt>0?` (${cnt})`:''}</button>;})}</div>
          {/* Active filter total */}
          {invFilter!=='All'&&(()=>{const fl=filteredInv();const tv=fl.reduce((s,i)=>s+parseFloat(i.total_cost||0),0);return fl.length>0&&<div style={{background:'var(--accent-light)',borderRadius:10,padding:'8px 14px',marginBottom:10,display:'flex',justifyContent:'space-between',alignItems:'center'}}><span style={{fontSize:13,fontWeight:600,color:'var(--accent)'}}>{invFilter}: {fl.length} items</span><span style={{fontSize:15,fontWeight:800,color:'var(--accent)'}}>{fmt(tv)}</span></div>;})()}
          {/* Sort + Search row */}
          <div style={{display:'flex',gap:8,marginBottom:10}}>
            <input style={{...S.inp,flex:1}} placeholder="Search items..." value={search} onChange={e=>setSearch(e.target.value)}/>
            <select style={{...S.inp,width:130,padding:'8px 10px',fontSize:13,appearance:'auto'}} value={stockSort} onChange={e=>setStockSort(e.target.value)}>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="highest">Highest $</option>
              <option value="lowest">Lowest $</option>
              <option value="name">A → Z</option>
              <option value="vendor">Vendor</option>
            </select>
          </div>
          {(()=>{
            let list = [...filteredInv()];
            if(stockSort==='newest') list.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
            if(stockSort==='oldest') list.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
            if(stockSort==='highest') list.sort((a,b)=>parseFloat(b.total_cost||0)-parseFloat(a.total_cost||0));
            if(stockSort==='lowest') list.sort((a,b)=>parseFloat(a.total_cost||0)-parseFloat(b.total_cost||0));
            if(stockSort==='name') list.sort((a,b)=>(a.title||'').localeCompare(b.title||''));
            if(stockSort==='vendor') list.sort((a,b)=>(a.auction_house||'').localeCompare(b.auction_house||''));
            if(list.length===0) return <Empty text="No items"/>;
            return list.map((item,i)=>{
              const ph=itemPhotos[item.id]||[]; const hasPh=ph.length>0&&ph[0].url; const nc=allNotes.filter(n=>n.item_id===item.id&&!n.is_resolved).length;
              return <div key={item.id} className="fade-up" style={{...S.card,marginBottom:10,animationDelay:`${i*20}ms`,...(nc>0?{borderLeft:'3px solid #F59E0B'}:{})}}>
                {/* Top row: thumbnail + info + price */}
                <div style={{display:'flex',gap:10,padding:'12px 14px',alignItems:'center'}}>
                  <div style={S.thumb} onClick={()=>{setModal({type:'photos',data:item});loadPhotos(item.id);}}>{hasPh?<img src={ph[0].url} alt="" style={S.thumbImg}/>:<span style={{fontSize:18,color:'var(--text-hint)'}}>📷</span>}</div>
                  <div style={{flex:1,minWidth:0}} onClick={()=>openProductDetail(item)}>
                    {(()=>{const st=getStatusInfo(getItemStatus(item));return<span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:6,background:st.bg,color:st.color,marginBottom:2,display:'inline-block'}}>{st.icon} {st.label}</span>;})()}
                    <p style={{fontSize:14,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.title}</p>
                    <p style={{fontSize:12,color:'var(--text-muted)'}}>{item.auction_house} · <b>Lot #{item.lot_number}</b></p>
                    {nc>0&&<Tag text={`${nc} issue${nc>1?'s':''}`} color="#92400E" bg="#FEF3C7"/>}
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}><p style={{fontSize:15,fontWeight:700,color:'var(--accent)'}}>{fmt(item.total_cost)}</p>{item.listing_price&&<p style={{fontSize:11,color:'var(--green)'}}>Ask {fmt(item.listing_price)}</p>}</div>
                </div>
                {/* Status chips row */}
                <div style={{display:'flex',gap:4,padding:'6px 14px',flexWrap:'wrap'}}>
                  {ITEM_STATUSES.map(st=>{const active=getItemStatus(item)===st.id;return<button key={st.id} style={{padding:'4px 10px',borderRadius:16,border:active?`2px solid ${st.color}`:'1px solid var(--border)',background:active?st.bg:'var(--bg-surface)',fontSize:11,fontFamily:'var(--font)',cursor:'pointer',fontWeight:active?700:400,color:active?st.color:'var(--text-muted)',transition:'all .15s'}} onClick={(e)=>{e.stopPropagation();if(active)return;if(st.id==='sold'){setQuickSellData({price:'',payMethod:'cash',deliveryCharge:''});setModal({type:'quickSell',data:item});}else setItemPurpose(item,st.id);}}>{st.icon} {st.label}</button>;})}
                </div>
                {/* Action buttons row */}
                <div style={S.acts}>
                  {hasPh?<button style={{...S.chip,background:'var(--accent-light)',color:'var(--accent)',fontWeight:700}} onClick={()=>{setModal({type:'photos',data:item});loadPhotos(item.id);}}>✏️ Edit Photos ({ph.length})</button>:<button style={S.chip} onClick={()=>{setModal({type:'photos',data:item});loadPhotos(item.id);}}>📷 Add Photos</button>}
                  <button style={{...S.chip,background:'var(--green-light)',color:'var(--green)',fontWeight:700}} onClick={()=>openCustomerShare(item)}>📤 Share</button>
                  <button style={{...S.chip,background:'#EBF5FF',color:'#2563EB',fontWeight:700}} onClick={()=>{setListStoreData({price:item.selling_price||item.listing_price||'',description:item.selling_description||''});setModal({type:'listStore',data:item});}}>🛒 Store</button>
                  <button style={S.chip} onClick={()=>{setModal({type:'notes',data:item,isSold:false});loadItemNotes(item.id,null);}}>💬{nc>0?` ${nc}`:''}</button>
                  <button style={S.chip} onClick={()=>setModal({type:'itemActions',data:item})}>⚙️ More</button>
                  {item.purpose!=='personal'&&<button style={{...S.chip,background:'var(--accent-light)',color:'var(--accent)',fontWeight:700}} onClick={()=>setModal({type:'sell',data:item})}>💰 Sell</button>}
                </div>
              </div>;
            });
          })()}
        </>}

        {/* SALES */}
        {tab==='sales'&&(()=>{
          const now=new Date();const startOfYear=new Date(now.getFullYear(),0,1);const startOfMonth=new Date(now.getFullYear(),now.getMonth(),1);const startOfWeek=new Date(now);startOfWeek.setDate(now.getDate()-now.getDay());startOfWeek.setHours(0,0,0,0);
          const ytdSold=sold.filter(s=>new Date(s.sold_at||s.created_at)>=startOfYear);
          const mtdSold=sold.filter(s=>new Date(s.sold_at||s.created_at)>=startOfMonth);
          const weekSold=sold.filter(s=>new Date(s.sold_at||s.created_at)>=startOfWeek);
          const calc=(arr)=>{const rev=arr.reduce((s,i)=>s+parseFloat(i.sold_price||0),0);const cost=arr.reduce((s,i)=>s+parseFloat(i.total_cost||0),0);const profit=arr.reduce((s,i)=>s+parseFloat(i.profit||0),0);const roi=cost>0?((profit/cost)*100).toFixed(1):0;return{rev,cost,profit,roi,count:arr.length};};
          const ytd=calc(ytdSold);const mtd=calc(mtdSold);const wk=calc(weekSold);const all=calc(sold);
          return<>
          <div style={S.hdr}><h1 style={{fontSize:24,fontWeight:800}}>Sales Dashboard</h1></div>

          {/* Period cards */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
            {[
              {label:'This Week',data:wk,c:'var(--accent)'},
              {label:'This Month',data:mtd,c:'var(--blue)'},
              {label:'Year to Date',data:ytd,c:'var(--green)'},
              {label:'All Time',data:all,c:'#7C3AED'},
            ].map(p=><div key={p.label} style={{...S.card,padding:'12px 14px',borderLeft:`3px solid ${p.c}`}}>
              <p style={{fontSize:10,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:.5,marginBottom:6}}>{p.label}</p>
              <p style={{fontSize:18,fontWeight:800,color:p.c,marginBottom:4}}>{fmt(p.data.rev)}</p>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--text-secondary)',marginBottom:2}}><span>Cost</span><span>{fmt(p.data.cost)}</span></div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:2}}><span style={{color:'var(--text-secondary)'}}>Profit</span><span style={{fontWeight:700,color:p.data.profit>=0?'var(--green)':'var(--red)'}}>{p.data.profit>=0?'+':''}{fmt(p.data.profit)}</span></div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:11}}><span style={{color:'var(--text-secondary)'}}>ROI</span><span style={{fontWeight:700,color:p.data.profit>=0?'var(--green)':'var(--red)'}}>{p.data.roi}%</span></div>
              <p style={{fontSize:10,color:'var(--text-muted)',marginTop:4}}>{p.data.count} item{p.data.count!==1?'s':''}</p>
            </div>)}
          </div>

          {/* Quick stats bar */}
          <div style={{display:'flex',gap:6,marginBottom:14,overflowX:'auto'}}>
            <div style={{background:'var(--bg-surface)',borderRadius:10,padding:'8px 14px',textAlign:'center',flex:1}}><p style={{fontSize:9,color:'var(--text-muted)'}}>AVG SALE</p><p style={{fontSize:15,fontWeight:700}}>{sold.length>0?fmt(all.rev/sold.length):'—'}</p></div>
            <div style={{background:'var(--bg-surface)',borderRadius:10,padding:'8px 14px',textAlign:'center',flex:1}}><p style={{fontSize:9,color:'var(--text-muted)'}}>AVG PROFIT</p><p style={{fontSize:15,fontWeight:700,color:all.profit>=0?'var(--green)':'var(--red)'}}>{sold.length>0?fmt(all.profit/sold.length):'—'}</p></div>
            <div style={{background:dueBills.length>0?'var(--red-light)':'var(--bg-surface)',borderRadius:10,padding:'8px 14px',textAlign:'center',flex:1}}><p style={{fontSize:9,color:dueBills.length>0?'var(--red)':'var(--text-muted)'}}>UNPAID</p><p style={{fontSize:15,fontWeight:700,color:dueBills.length>0?'var(--red)':'var(--text)'}}>{dueBills.length>0?fmt(dueBills.reduce((s,i)=>s+parseFloat(i.sold_price||0),0)):'$0'}</p></div>
          </div>

          {/* Filter pills + Bill button */}
          <div style={S.pills}>{SALE_FILTERS.map(f=><button key={f} style={{...S.pill,...(saleFilter===f?S.pillOn:{})}} onClick={()=>setSaleFilter(f)}>{f}{f==='Due'&&dueBills.length?` (${dueBills.length})`:''}</button>)}</div>
          {saleFilter==='New Bill'&&<button style={{...S.btn1,width:'100%',marginBottom:14}} onClick={()=>setModal({type:'billOfSale'})}>🧾 Create Bill of Sale</button>}

          {/* Items list */}
          {(()=>{
            const list=saleFilter==='New Bill'?sold:saleFilter==='Due'?dueBills:closedBills;
            if(list.length===0) return <Empty text={saleFilter==='Due'?'No unpaid bills':'No sales yet'}/>;
            return list.map((si,i)=><SC key={si.id} si={si} i={i} photoUrl={(itemPhotos[si.item_id]||itemPhotos[si.id]||[])[0]?.url||null} onBill={()=>viewBill(si)} onShare={()=>setModal({type:'share',data:si})} onLC={()=>handleLC(si,true)} onNote={()=>{setModal({type:'notes',data:si,isSold:true});loadItemNotes(null,si.id);}} onMarkPaid={si.bill_status==='due'?()=>markBillPaid(si):null} onEdit={()=>openEditSold(si)} onReturn={()=>returnToInventory(si)} noteCount={allNotes.filter(n=>n.sold_item_id===si.id&&!n.is_resolved).length}/>);
          })()}
        </>;})()}

        {/* RETURNS */}
        {tab==='returns'&&<>
          <div style={S.hdr}><h1 style={{fontSize:24,fontWeight:800}}>Returns</h1><p style={{fontSize:13,color:'var(--text-muted)'}}>{savedReturns.length} saved · {returnItems.length} pending</p></div>

          {/* Sub-tabs: New / Saved */}
          <div style={S.pills}>
            <button style={{...S.pill,...(returnTab==='new'?S.pillOn:{})}} onClick={()=>setReturnTab('new')}>+ Search & Add</button>
            <button style={{...S.pill,...(returnTab==='manual'?S.pillOn:{})}} onClick={()=>setReturnTab('manual')}>✍️ Manual</button>
            <button style={{...S.pill,...(returnTab==='saved'?S.pillOn:{})}} onClick={()=>setReturnTab('saved')}>📁 Saved ({savedReturns.length})</button>
          </div>

          {/* NEW RETURN TAB */}
          {returnTab==='new'&&<>
            <input style={{...S.inp,marginBottom:8}} placeholder="Search lot #, invoice #, item name..." value={returnSearch} onChange={e=>setReturnSearch(e.target.value)}/>
            {returnSearch.trim()&&<div style={{maxHeight:200,overflow:'auto',border:'1px solid var(--border)',borderRadius:12,marginBottom:14}}>
              {searchReturnable().length===0?<p style={{padding:16,textAlign:'center',color:'var(--text-muted)',fontSize:13}}>No items found</p>:searchReturnable().map(item=><div key={item.id+item._src} style={{display:'flex',gap:10,padding:'10px 14px',borderBottom:'1px solid var(--border-light)',alignItems:'center',cursor:'pointer'}} onClick={()=>{addToReturn(item);setReturnSearch('');}}>
                <div style={{flex:1,minWidth:0}}><p style={{fontSize:13,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.title}</p><p style={{fontSize:11,color:'var(--text-muted)'}}>Lot #{item.lot_number||'—'} · {item.auction_house} · {fmt(item.total_cost)}</p></div>
                <span style={{fontSize:10,padding:'2px 6px',borderRadius:4,background:item._src==='sold'?'var(--green-light)':'var(--accent-light)',color:item._src==='sold'?'var(--green)':'var(--accent)',fontWeight:600}}>{item._src==='sold'?'Sold':'Stock'}</span>
                <span style={{color:'var(--accent)',fontWeight:700,fontSize:20}}>+</span>
              </div>)}
            </div>}

            {returnItems.length===0?<Empty text="Search and add items for return"/>:<>
              <p style={S.secT}>Return Items ({returnItems.length})</p>
              {returnItems.map((item,i)=>{const ph=itemPhotos[item.id]||[];const rp=returnPhotos[item.id]||[];const inv=getItemInvoice(item);const reason=returnReasons[item.id]||'';return<div key={item.id} className="fade-up" style={{...S.card,marginBottom:10,animationDelay:`${i*20}ms`,borderLeft:'3px solid #C2410C'}}>
                <div style={{padding:'12px 14px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
                    <div><p style={{fontSize:15,fontWeight:700}}>{item.title}</p><p style={{fontSize:12,color:'var(--text-muted)'}}>Lot #{item.lot_number||'—'} · Invoice #{inv?.invoice_number||'—'} · {item.auction_house}</p></div>
                    <button style={{background:'none',border:'none',color:'var(--red)',fontSize:18,cursor:'pointer'}} onClick={()=>removeFromReturn(item.id)}>✕</button>
                  </div>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8}}>
                    <span style={{fontSize:11,padding:'2px 8px',borderRadius:6,background:'var(--bg-surface)'}}>Hammer: {fmt(item.hammer_price)}</span>
                    <span style={{fontSize:11,padding:'2px 8px',borderRadius:6,background:'var(--bg-surface)'}}>Tax: {fmt(item.tax_amount)}</span>
                    {parseFloat(item.other_fees||0)>0&&<span style={{fontSize:11,padding:'2px 8px',borderRadius:6,background:'#FEF3C7',color:'#92400E'}}>{item.other_fees_desc||'Fees'}: {fmt(item.other_fees)}</span>}
                    <span style={{fontSize:11,padding:'2px 8px',borderRadius:6,background:'var(--accent-light)',color:'var(--accent)',fontWeight:700}}>Total: {fmt(item.total_cost)}</span>
                  </div>
                  {/* Per-item reason */}
                  <textarea style={{...S.inp,minHeight:40,resize:'vertical',fontSize:13,marginBottom:8,borderColor:reason?'var(--green)':'var(--border)'}} placeholder="Reason for return (this item)..." value={reason} onChange={e=>setReturnReasons(prev=>({...prev,[item.id]:e.target.value}))}/>
                  {/* Original photos */}
                  {ph.length>0&&<><p style={{fontSize:11,fontWeight:600,color:'var(--text-muted)',marginBottom:4}}>Original Photos ({ph.length})</p><div style={{display:'flex',gap:4,overflowX:'auto',marginBottom:8}}>{ph.filter(p=>p.url).map((p,pi)=><img key={p.id||pi} src={p.url} alt="" style={{width:52,height:52,borderRadius:8,objectFit:'cover',flexShrink:0,border:'1px solid var(--border-light)'}}/>)}</div></>}
                  {/* Return photos */}
                  <p style={{fontSize:11,fontWeight:600,color:'#C2410C',marginBottom:4}}>Return Photos ({rp.length})</p>
                  {rp.length>0&&<div style={{display:'flex',gap:4,overflowX:'auto',marginBottom:6}}>{rp.map((p,pi)=><div key={p.id||pi} style={{position:'relative',flexShrink:0}}><img src={p.url} alt="" style={{width:52,height:52,borderRadius:8,objectFit:'cover',border:'2px solid #C2410C'}}/><button onClick={()=>setReturnPhotos(prev=>({...prev,[item.id]:prev[item.id].filter((_,j)=>j!==pi)}))} style={{position:'absolute',top:-4,right:-4,width:18,height:18,borderRadius:9,background:'var(--red)',color:'#fff',border:'none',fontSize:10,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>✕</button></div>)}</div>}
                  <label role="button" style={{...S.chip,display:'inline-block',background:'#FFF7ED',color:'#C2410C',fontWeight:600,fontSize:11,cursor:'pointer'}}><input type="file" accept="image/*" multiple onChange={e=>handleReturnPhoto(item.id,e)} style={{display:'none'}}/>📷 Add Return Photos</label>
                  <button style={{...S.chip,display:'inline-block',background:'var(--accent-light)',color:'var(--accent)',fontWeight:600,fontSize:11,marginLeft:4}} onClick={()=>openProductDetail(item)}>👁 View Details</button>
                </div>
              </div>;})}

              {/* Invoice copy toggle */}
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',background:'var(--bg-surface)',borderRadius:10,marginBottom:10}}>
                <div><p style={{fontSize:13,fontWeight:600}}>📄 Include Invoice Copy</p><p style={{fontSize:11,color:'var(--text-muted)'}}>Adds invoice page on top of PDF</p></div>
                <button onClick={()=>setPrintIncludeInvoice(!printIncludeInvoice)} style={{width:48,height:28,borderRadius:14,border:'none',background:printIncludeInvoice?'var(--green)':'var(--border)',position:'relative',cursor:'pointer',transition:'background .2s'}}><div style={{width:22,height:22,borderRadius:11,background:'#fff',position:'absolute',top:3,left:printIncludeInvoice?23:3,transition:'left .2s',boxShadow:'0 1px 3px rgba(0,0,0,.2)'}}/></button>
              </div>

              {/* Actions */}
              <div style={{display:'flex',flexDirection:'column',gap:8,marginTop:8}}>
                <button style={{...S.btn1,width:'100%',background:'var(--green)'}} onClick={()=>{if(!returnItems.every(i=>returnReasons[i.id]?.trim())){if(!confirm('Some items have no reason entered. Save anyway?'))return;}saveReturnRequest();}}>💾 Save Return Request</button>
                <button style={{...S.btn1,width:'100%',background:'#C2410C'}} onClick={()=>generateReturnPDF(true,printIncludeInvoice)}>🖨 Print With Details</button>
                <button style={{...S.btn2,width:'100%'}} onClick={()=>generateReturnPDF(false,printIncludeInvoice)}>🖨 Print Without Details (4/page)</button>
                <button style={{...S.btn2,width:'100%',color:'var(--red)'}} onClick={()=>{if(confirm('Clear all?')){setReturnItems([]);setReturnPhotos({});setReturnReasons({});}}}>🗑 Clear All</button>
              </div>
            </>}
          </>}

          {/* MANUAL RETURN TAB */}
          {returnTab==='manual'&&<>
            {/* Invoice header — shared across all items */}
            <div style={{...S.card,padding:14,marginBottom:12,background:'#FFF7ED',border:'1px solid #C2410C'}}>
              <p style={{fontSize:13,fontWeight:700,color:'#C2410C',marginBottom:8}}>Invoice Details</p>
              <label style={S.label}>Invoice #</label>
              <input style={S.inp} placeholder="e.g. 71600" value={manualReturn.invoiceNumber} onChange={e=>setManualReturn({...manualReturn,invoiceNumber:e.target.value})}/>
              <label style={S.label}>Vendor Name</label>
              <input style={S.inp} placeholder="e.g. Ruito Trading Inc." value={manualReturn.vendor} onChange={e=>setManualReturn({...manualReturn,vendor:e.target.value})}/>
              <label style={S.label}>Date</label>
              <input style={S.inp} type="date" value={manualReturn.bidDate} onChange={e=>setManualReturn({...manualReturn,bidDate:e.target.value})}/>
            </div>
            <div style={{display:'flex',gap:8,marginBottom:10}}>
              <button style={{...S.btn1,flex:1,fontSize:13}} onClick={()=>setManualReturnItems(p=>[...p,{id:'mr_'+Date.now(),lotNumber:'',title:'',photos:[]}])}>+ Add 1</button>
              <button style={{...S.btn2,flex:1,fontSize:13}} onClick={()=>{const b=[];for(let x=0;x<5;x++)b.push({id:'mr_'+Date.now()+'_'+x,lotNumber:'',title:'',photos:[]});setManualReturnItems(p=>[...p,...b]);}}>+ Add 5</button>
              <button style={{...S.btn2,flex:1,fontSize:13}} onClick={()=>{const b=[];for(let x=0;x<10;x++)b.push({id:'mr_'+Date.now()+'_'+x,lotNumber:'',title:'',photos:[]});setManualReturnItems(p=>[...p,...b]);}}>+ Add 10</button>
            </div>
            {manualReturnItems.length>0&&<p style={{fontSize:13,fontWeight:700,color:'#C2410C',marginBottom:8}}>{manualReturnItems.length} item{manualReturnItems.length!==1?'s':''} for return</p>}
            {manualReturnItems.map((item,i)=><div key={item.id} style={{...S.card,marginBottom:8,borderLeft:'3px solid #C2410C',padding:'10px 12px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                <p style={{fontSize:13,fontWeight:700}}>#{i+1} — Inv #{manualReturn.invoiceNumber||'?'} · {manualReturn.vendor||'?'}</p>
                <button style={{background:'none',border:'none',color:'var(--red)',fontSize:18,cursor:'pointer',padding:'0 4px'}} onClick={()=>setManualReturnItems(p=>p.filter((_,j)=>j!==i))}>✕</button>
              </div>
              <div style={{display:'flex',gap:8,marginBottom:6}}>
                <div style={{flex:1}}><label style={S.label}>Lot #</label><input style={S.inp} placeholder="Lot number" value={item.lotNumber} onChange={e=>{const v=[...manualReturnItems];v[i]={...v[i],lotNumber:e.target.value};setManualReturnItems(v);}}/></div>
                <div style={{flex:2}}><label style={S.label}>Item Name</label><input style={S.inp} placeholder="Product name" value={item.title} onChange={e=>{const v=[...manualReturnItems];v[i]={...v[i],title:e.target.value};setManualReturnItems(v);}}/></div>
              </div>
              {item.photos.length>0&&<div style={{display:'flex',gap:4,overflowX:'auto',marginBottom:6,paddingBottom:2}}>{item.photos.map((p,pi)=><div key={pi} style={{position:'relative',flexShrink:0}}><img src={p} alt="" style={{width:64,height:64,borderRadius:8,objectFit:'cover',border:'2px solid #C2410C'}}/><button onClick={()=>{const v=[...manualReturnItems];v[i]={...v[i],photos:v[i].photos.filter((_,j)=>j!==pi)};setManualReturnItems(v);}} style={{position:'absolute',top:-5,right:-5,width:20,height:20,borderRadius:10,background:'#DC2626',color:'#fff',border:'none',fontSize:12,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button></div>)}</div>}
              <label role="button" style={{...S.chip,background:'#FFF7ED',color:'#C2410C',fontWeight:700,fontSize:12,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:4}}><input type="file" accept="image/*" multiple onChange={async(e)=>{const files=Array.from(e.target.files||[]);if(!files.length)return;const compressed=[];for(const f of files){const du=await new Promise(res=>{const img=new Image();const rd=new FileReader();rd.onload=()=>{img.onload=()=>{const c=document.createElement('canvas');const mx=400;let w=img.width,h=img.height;if(w>mx||h>mx){if(w>h){h=h*(mx/w);w=mx;}else{w=w*(mx/h);h=mx;}}c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);res(c.toDataURL('image/jpeg',0.7));};img.src=rd.result;};rd.readAsDataURL(f);});compressed.push(du);}const v=[...manualReturnItems];v[i]={...v[i],photos:[...v[i].photos,...compressed]};setManualReturnItems(v);}} style={{display:'none'}}/>📷 Add Photos ({item.photos.length})</label>
            </div>)}
            {manualReturnItems.length>0&&<div style={{display:'flex',flexDirection:'column',gap:8,marginTop:14}}>
              <button style={{...S.btn1,width:'100%',background:'#C2410C',fontSize:15,padding:'14px'}} onClick={()=>{const mr=manualReturn;const its=manualReturnItems.filter(i=>i.lotNumber||i.title);if(!its.length){notify('err','Add at least one item');return;}const ihtml=its.map((item,idx)=>`<div class="item"><div class="ih"><span class="num">#${idx+1}</span><h2>${item.title||'Lot '+item.lotNumber}</h2></div><table><tr><td>Lot #</td><td><b>${item.lotNumber||'—'}</b></td></tr><tr><td>Invoice #</td><td>${mr.invoiceNumber||'—'}</td></tr><tr><td>Vendor</td><td>${mr.vendor||'—'}</td></tr><tr><td>Date</td><td>${mr.bidDate||'—'}</td></tr></table>${item.photos.length>0?`<div class="photos">${item.photos.map(p=>`<img src="${p}"/>`).join('')}</div>`:''}</div>`).join('');const html=`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Return — ${mr.vendor||''} #${mr.invoiceNumber||''}</title><style>@page{size:A4 portrait;margin:12mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,Arial,sans-serif;color:#1a1a1a;-webkit-print-color-adjust:exact;print-color-adjust:exact}h1{font-size:18pt;text-align:center;margin-bottom:2mm}h1 span{color:#C2410C}.meta{text-align:center;color:#666;font-size:10pt;margin-bottom:4mm}.hdr{border:2px solid #C2410C;border-radius:3mm;padding:5mm;margin-bottom:6mm}.hdr table{width:100%;font-size:11pt;border-collapse:collapse}.hdr td{padding:2mm 3mm;border-bottom:1px solid #eee}.hdr td:first-child{width:120px;color:#666;font-weight:600}.item{border:1.5px solid #ddd;border-radius:3mm;padding:4mm;margin-bottom:4mm;page-break-inside:avoid}.ih{display:flex;align-items:center;gap:3mm;margin-bottom:2mm}.num{background:#C2410C;color:#fff;padding:1mm 3mm;border-radius:2mm;font-size:9pt;font-weight:700}.item h2{font-size:12pt}table{width:100%;font-size:10pt;border-collapse:collapse;margin-bottom:2mm}td{padding:1.5mm 3mm;border-bottom:1px solid #eee}td:first-child{width:80px;color:#888}.photos{display:flex;gap:3mm;flex-wrap:wrap;margin-top:2mm}.photos img{width:38mm;height:38mm;object-fit:cover;border-radius:2mm;border:1px solid #ddd}</style></head><body><h1><span>↩</span> Return Report</h1><p class="meta">${its.length} item(s) · ${new Date().toLocaleDateString('en-CA')}</p><div class="hdr"><table><tr><td>Invoice #</td><td><b>${mr.invoiceNumber||'—'}</b></td></tr><tr><td>Vendor</td><td><b>${mr.vendor||'—'}</b></td></tr><tr><td>Date</td><td>${mr.bidDate||'—'}</td></tr></table></div>${ihtml}</body></html>`;const w=window.open('','_blank','width=800,height=1000');w.document.write(html);w.document.close();const wp=()=>{const imgs=w.document.querySelectorAll('img');let ok=true;imgs.forEach(im=>{if(!im.complete)ok=false;});if(ok||imgs.length===0)setTimeout(()=>{w.focus();w.print();},300);else setTimeout(wp,200);};setTimeout(wp,300);}}>🖨 Print ({manualReturnItems.filter(i=>i.lotNumber||i.title).length} items)</button>
              <button style={{...S.btn1,width:'100%',background:'var(--green)',fontSize:15,padding:'14px'}} onClick={()=>{const its=manualReturnItems.filter(i=>i.lotNumber||i.title);if(!its.length){notify('err','Add at least one item');return;}const cluster={id:uid(),date:new Date().toISOString(),manual:true,invoiceNumber:manualReturn.invoiceNumber,vendor:manualReturn.vendor,bidDate:manualReturn.bidDate,items:its.map(i=>({id:i.id,title:i.title,lot_number:i.lotNumber,photos:i.photos}))};const updated=[cluster,...savedReturns];try{localStorage.setItem('av_returns',JSON.stringify(updated));setSavedReturns(updated);setManualReturnItems([]);setManualReturn({invoiceNumber:'',bidDate:'',invoiceTotal:'',vendor:''});notify('ok',`✅ Saved — ${its.length} items`);}catch(e){const lite={...cluster,items:cluster.items.map(i=>({...i,photos:[]}))};const u2=[lite,...savedReturns];try{localStorage.setItem('av_returns',JSON.stringify(u2));setSavedReturns(u2);setManualReturnItems([]);setManualReturn({invoiceNumber:'',bidDate:'',invoiceTotal:'',vendor:''});notify('info','Saved without photos (storage full)');}catch(e2){notify('err','Storage full — print first');}}
              }}>💾 Save</button>
              <button style={{...S.btn2,width:'100%',color:'var(--red)'}} onClick={()=>{if(confirm('Clear all?'))setManualReturnItems([]);}}>🗑 Clear</button>
            </div>}
          </>}

          {/* SAVED RETURNS TAB */}
          {returnTab==='saved'&&<>
            {savedReturns.length===0?<Empty text="No saved returns"/>:savedReturns.map((cluster,ci)=><div key={cluster.id} className="fade-up" style={{...S.card,marginBottom:10,animationDelay:`${ci*20}ms`,borderLeft:'3px solid #C2410C'}}>
              <div style={{padding:'14px 16px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
                  <div><p style={{fontSize:15,fontWeight:700}}>{cluster.vendor||'Return'} #{cluster.invoiceNumber||ci+1}</p><p style={{fontSize:12,color:'var(--text-muted)'}}>{fmtDate(cluster.bidDate||cluster.date)} · {cluster.items.length} item{cluster.items.length!==1?'s':''}</p></div>
                  <button style={{...S.chip,color:'var(--red)',fontSize:11}} onClick={()=>deleteReturnRequest(cluster.id)}>🗑</button>
                </div>
                {cluster.items.map((item,ii)=><div key={ii} style={{display:'flex',gap:8,padding:'6px 0',borderTop:'1px solid var(--border-light)',alignItems:'center'}}>
                  {item.photos?.length>0?<img src={item.photos[0]} alt="" style={{width:40,height:40,borderRadius:6,objectFit:'cover',flexShrink:0}}/>:<div style={{width:40,height:40,borderRadius:6,background:'var(--bg-surface)',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14}}>📷</div>}
                  <div style={{flex:1}}><p style={{fontSize:13,fontWeight:600}}>{item.title||'—'}</p><p style={{fontSize:11,color:'var(--text-muted)'}}>Lot #{item.lot_number||'—'}{item.photos?.length>0?` · ${item.photos.length} photo${item.photos.length>1?'s':''}`:''}</p></div>
                </div>)}
                <div style={{display:'flex',gap:6,marginTop:10}}>
                  <button style={{...S.chip,background:'var(--accent-light)',color:'var(--accent)',fontWeight:700,fontSize:12}} onClick={()=>{setManualReturn({invoiceNumber:cluster.invoiceNumber||'',vendor:cluster.vendor||'',bidDate:cluster.bidDate||'',invoiceTotal:''});setManualReturnItems(cluster.items.map(i=>({id:i.id||'mr_'+Date.now(),lotNumber:i.lot_number||'',title:i.title||'',photos:i.photos||[]})));setReturnTab('manual');notify('ok','Loaded');}}>✏️ Reopen</button>
                  <button style={{...S.chip,background:'#FFF7ED',color:'#C2410C',fontWeight:700,fontSize:12}} onClick={()=>{const mr={invoiceNumber:cluster.invoiceNumber,vendor:cluster.vendor,bidDate:cluster.bidDate};const its=cluster.items;const ihtml=its.map((item,idx)=>`<div class="item"><div class="ih"><span class="num">#${idx+1}</span><h2>${item.title||'Lot '+item.lot_number}</h2></div><table><tr><td>Lot #</td><td><b>${item.lot_number||'—'}</b></td></tr><tr><td>Invoice #</td><td>${mr.invoiceNumber||'—'}</td></tr><tr><td>Vendor</td><td>${mr.vendor||'—'}</td></tr><tr><td>Date</td><td>${mr.bidDate||'—'}</td></tr></table>${item.photos?.length>0?`<div class="photos">${item.photos.map(p=>`<img src="${p}"/>`).join('')}</div>`:''}</div>`).join('');const html=`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Return Report</title><style>@page{size:A4 portrait;margin:12mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,Arial,sans-serif;color:#1a1a1a;-webkit-print-color-adjust:exact;print-color-adjust:exact}h1{font-size:18pt;text-align:center;margin-bottom:2mm}h1 span{color:#C2410C}.meta{text-align:center;color:#666;font-size:10pt;margin-bottom:4mm}.hdr{border:2px solid #C2410C;border-radius:3mm;padding:5mm;margin-bottom:6mm}.hdr table{width:100%;font-size:11pt;border-collapse:collapse}.hdr td{padding:2mm 3mm;border-bottom:1px solid #eee}.hdr td:first-child{width:120px;color:#666;font-weight:600}.item{border:1.5px solid #ddd;border-radius:3mm;padding:4mm;margin-bottom:4mm;page-break-inside:avoid}.ih{display:flex;align-items:center;gap:3mm;margin-bottom:2mm}.num{background:#C2410C;color:#fff;padding:1mm 3mm;border-radius:2mm;font-size:9pt;font-weight:700}.item h2{font-size:12pt}table{width:100%;font-size:10pt;border-collapse:collapse;margin-bottom:2mm}td{padding:1.5mm 3mm;border-bottom:1px solid #eee}td:first-child{width:80px;color:#888}.photos{display:flex;gap:3mm;flex-wrap:wrap;margin-top:2mm}.photos img{width:38mm;height:38mm;object-fit:cover;border-radius:2mm;border:1px solid #ddd}</style></head><body><h1><span>↩</span> Return Report</h1><p class="meta">${its.length} item(s) · ${fmtDate(cluster.date)}</p><div class="hdr"><table><tr><td>Invoice #</td><td><b>${mr.invoiceNumber||'—'}</b></td></tr><tr><td>Vendor</td><td><b>${mr.vendor||'—'}</b></td></tr><tr><td>Date</td><td>${mr.bidDate||'—'}</td></tr></table></div>${ihtml}</body></html>`;const w=window.open('','_blank','width=800,height=1000');w.document.write(html);w.document.close();const wp=()=>{const imgs=w.document.querySelectorAll('img');let ok=true;imgs.forEach(im=>{if(!im.complete)ok=false;});if(ok||imgs.length===0)setTimeout(()=>{w.focus();w.print();},300);else setTimeout(wp,200);};setTimeout(wp,300);}}>🖨 Print</button>
                </div>
              </div>
            </div>)}
          </>}
        </>}

        {/* ACCOUNT + ISSUES merged */}
        {tab==='account'&&<>
          <div style={S.hdr}><h1 style={{fontSize:24,fontWeight:800}}>Account</h1></div>
          <div style={{...S.card,padding:16,marginBottom:12,display:'flex',justifyContent:'space-between',alignItems:'center'}}><p style={{fontSize:14,fontWeight:600}}>{user?.email}</p><button style={{...S.chip,color:'var(--red)',fontWeight:600}} onClick={()=>db.signOut()}>Sign Out</button></div>
          <button style={{...S.btn1,width:'100%',marginBottom:14,background:'#2563EB'}} onClick={()=>window.open('/store','_blank')}>🛒 Open My Store — Share with Customers</button>
          <button style={{...S.btn2,width:'100%',marginBottom:14}} onClick={()=>{const url=window.location.origin+'/store';navigator.clipboard?.writeText(url);notify('ok','Store link copied!');}}>📋 Copy Store Link</button>

          {/* Issues section inside Account */}
          {(openNotes.length>0||resolvedNotes.length>0)&&<>
            <p style={S.secT}>Issues & Notes ({openNotes.length} open)</p>
            <div style={S.pills}>{ISSUE_FILTERS.map(f=><button key={f} style={{...S.pill,...(issueFilter===f?S.pillOn:{})}} onClick={()=>setIssueFilter(f)}>{f}{f==='Open'&&openNotes.length?` (${openNotes.length})`:''}</button>)}</div>
            {(()=>{const notes=issueFilter==='Open'?openNotes:issueFilter==='Resolved'?resolvedNotes:allNotes;if(notes.length===0)return<p style={{color:'var(--text-muted)',fontSize:13,textAlign:'center',padding:16}}>{issueFilter==='Open'?'All clear!':'No notes'}</p>;return notes.slice(0,10).map((note,i)=>{const cat=getCat(note.category);return<div key={note.id} className="fade-up" style={{...S.card,marginBottom:8,animationDelay:`${i*20}ms`,borderLeft:`3px solid ${cat.color}`,opacity:note.is_resolved?.6:1,padding:'14px 16px'}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}><span style={{fontSize:12,fontWeight:600,color:cat.color,padding:'3px 10px',borderRadius:6,background:cat.bg}}>{cat.icon} {cat.label}</span>{note.is_resolved&&<Tag text="Resolved" color="var(--green)" bg="var(--green-light)"/>}</div><p style={{fontSize:14,fontWeight:600,marginBottom:2}}>{noteItemName(note)}</p><p style={{fontSize:14,color:'var(--text)',lineHeight:1.4,marginBottom:4}}>{note.note}</p><p style={{fontSize:11,color:'var(--text-muted)'}}>{fmtTs(note.created_at)}</p>{!note.is_resolved&&<div style={{display:'flex',gap:6,marginTop:8}}><button style={{...S.chip,background:'var(--green-light)',color:'var(--green)',fontWeight:700}} onClick={()=>resolveNote(note.id,note.item_id,note.sold_item_id)}>✅ Resolve</button><button style={{...S.chip,color:'var(--red)'}} onClick={()=>deleteNoteById(note.id,note.item_id,note.sold_item_id)}>🗑 Delete</button></div>}</div>;});})()}
          </>}

          <p style={S.secT}>Business Info</p>
          <div style={{...S.card,padding:16}}>
            {[['Business Name','business_name'],['Address','address'],['Phone','phone'],['Email','email'],['HST #','hst']].map(([l,k])=><div key={k}><label style={S.label}>{l}</label><input style={S.inp} value={biz[k]||''} onChange={e=>setBiz({...biz,[k]:e.target.value})}/></div>)}
            <button style={{...S.btn1,width:'100%',marginTop:14}} onClick={async()=>{await db.upsertSettings(biz);notify('ok','Saved');}}>Save</button>
          </div>
          <button style={{width:'100%',padding:14,marginTop:16,background:'var(--red-light)',border:'1px solid var(--red)',borderRadius:12,color:'var(--red)',fontSize:14,fontFamily:'var(--font)',cursor:'pointer'}} onClick={async()=>{if(!confirm('⚠️ WARNING: This will permanently delete ALL your invoices, items, photos, sales, and notes. This CANNOT be undone.\n\nAre you absolutely sure?'))return;const typed=prompt('Type DELETE to confirm:');if(typed!=='DELETE'){notify('ok','Cancelled — data is safe');return;}await db.clearAllData();await load();notify('ok','All data cleared');}}>⚠️ Reset All Data</button>
          <button style={{width:'100%',padding:12,marginTop:10,background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,color:'var(--text-secondary)',fontSize:13,fontFamily:'var(--font)',cursor:'pointer'}} onClick={()=>{if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(regs=>{regs.forEach(r=>r.unregister());});caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k))));setTimeout(()=>window.location.reload(true),500);}else{window.location.reload(true);}}}>🔄 Force Update App</button>
          <p style={{textAlign:'center',color:'var(--text-hint)',fontSize:11,marginTop:10}}>Version 2.5 · {new Date().toLocaleDateString()}</p>
        </>}
      </main>

      {/* NAV */}
      <nav style={S.nav}>{TABS.map(t=><button key={t.id} onClick={()=>{setTab(t.id);setSearch('');setInvSearch('');}} style={{...S.navBtn,color:tab===t.id?'var(--accent)':'var(--text-muted)'}}><span style={{fontSize:20}}>{t.icon}</span><span style={{fontSize:10,fontWeight:tab===t.id?700:400,marginTop:1}}>{t.label}</span>{t.id==='invoices'&&invoices.length>0&&<span style={S.badge}>{invoices.length}</span>}{t.id==='inventory'&&items.length>0&&<span style={S.badge}>{items.length}</span>}{t.id==='returns'&&returnItems.length>0&&<span style={{...S.badge,background:'#C2410C'}}>{returnItems.length}</span>}{t.id==='sales'&&dueBills.length>0&&<span style={{...S.badge,background:'var(--red)'}}>{dueBills.length}</span>}{t.id==='account'&&openNotes.length>0&&<span style={{...S.badge,background:'#F59E0B'}}>{openNotes.length}</span>}</button>)}</nav>

      {/* ═══ MODALS ═══ */}

      {/* PRODUCT DETAIL — full item info */}
      {modal?.type==='productDetail'&&(()=>{const it=modal.data;const inv=getItemInvoice(it);const ph=(itemPhotos[it.id]||[]).filter(p=>p.url);const st=getStatusInfo(getItemStatus(it));const nc=allNotes.filter(n=>n.item_id===it.id&&!n.is_resolved).length;return<OL close={closeModal}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
          <div><h3 style={S.mT}>{it.title}</h3><span style={{fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:6,background:st.bg,color:st.color}}>{st.icon} {st.label}</span></div>
          <p style={{fontSize:18,fontWeight:800,color:'var(--accent)'}}>{fmt(it.total_cost)}</p>
        </div>

        {/* Photos carousel */}
        {ph.length>0&&<div style={{display:'flex',gap:6,overflowX:'auto',marginBottom:14,paddingBottom:4}}>
          {ph.map((p,i)=><img key={p.id||i} src={p.url} alt="" style={{width:ph.length===1?'100%':140,height:ph.length===1?'auto':140,minHeight:80,borderRadius:12,objectFit:'cover',flexShrink:0,cursor:'pointer'}} onClick={()=>setPhotoPreview(p)}/>)}
        </div>}

        {/* Details grid */}
        <div style={{background:'var(--bg-surface)',borderRadius:12,padding:14,marginBottom:12}}>
          {[
            ['Lot Number', it.lot_number || '—'],
            ['Invoice #', inv?.invoice_number || '—'],
            ['Vendor', it.auction_house || '—'],
            ['Invoice Date', fmtDate(it.date) || '—'],
            ['Location', it.pickup_location || inv?.pickup_location || '—'],
            ['Payment', it.payment_method || inv?.payment_method || '—'],
            ['Purchased', fmtDate(it.created_at) || '—'],
          ].map(([l,v])=><div key={l} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid var(--border-light)'}}><span style={{fontSize:13,color:'var(--text-muted)'}}>{l}</span><span style={{fontSize:13,fontWeight:600}}>{v}</span></div>)}
        </div>

        {/* Cost breakdown */}
        <div style={{background:'var(--bg-surface)',borderRadius:12,padding:14,marginBottom:12}}>
          <p style={{...S.label,marginBottom:6}}>COST BREAKDOWN</p>
          {[
            ['Hammer Price', fmt(it.hammer_price)],
            ['Premium', fmt(it.premium_amount)],
            ['Tax', fmt(it.tax_amount)],
            ...(parseFloat(it.other_fees)>0 ? [[it.other_fees_desc||'Other Fees', fmt(it.other_fees)]] : []),
          ].map(([l,v])=><div key={l} style={{display:'flex',justifyContent:'space-between',padding:'4px 0'}}><span style={{fontSize:13,color:'var(--text-muted)'}}>{l}</span><span style={{fontSize:13}}>{v}</span></div>)}
          <div style={{display:'flex',justifyContent:'space-between',padding:'8px 0 0',borderTop:'1px solid var(--border)',marginTop:4}}><span style={{fontSize:14,fontWeight:700}}>Total Cost</span><span style={{fontSize:16,fontWeight:800,color:'var(--accent)'}}>{fmt(it.total_cost)}</span></div>
        </div>

        {/* Status chips */}
        <p style={{...S.label,marginBottom:6}}>STATUS</p>
        <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:14}}>
          {ITEM_STATUSES.map(s=>{const active=getItemStatus(it)===s.id;return<button key={s.id} style={{padding:'5px 10px',borderRadius:16,border:active?`2px solid ${s.color}`:'1px solid var(--border)',background:active?s.bg:'var(--bg-surface)',fontSize:11,fontFamily:'var(--font)',cursor:'pointer',fontWeight:active?700:400,color:active?s.color:'var(--text-muted)'}} onClick={()=>{if(s.id==='sold'){closeModal();setTimeout(()=>{setQuickSellData({price:'',payMethod:'cash',deliveryCharge:''});setModal({type:'quickSell',data:it});},50);}else{setItemPurpose(it,s.id);closeModal();}}}>{s.icon} {s.label}</button>;})}
        </div>

        {/* Actions */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          <button style={{...S.btn1,fontSize:13,padding:'12px'}} onClick={()=>{closeModal();setTimeout(()=>{setModal({type:'photos',data:it});loadPhotos(it.id);},50);}}>📷 Photos{ph.length>0?` (${ph.length})`:''}</button>
          <button style={{...S.btn2,fontSize:13,padding:'12px'}} onClick={()=>{closeModal();setTimeout(()=>openCustomerShare(it),50);}}>📤 Share</button>
          <button style={{...S.btn2,fontSize:13,padding:'12px'}} onClick={()=>{closeModal();setTimeout(()=>{setListStoreData({price:it.selling_price||it.listing_price||'',description:it.selling_description||''});setModal({type:'listStore',data:it});},50);}}>🛒 Store</button>
          <button style={{...S.btn2,fontSize:13,padding:'12px'}} onClick={()=>{closeModal();setTimeout(()=>setModal({type:'sell',data:it}),50);}}>💰 Sell</button>
          <button style={{...S.btn2,fontSize:13,padding:'12px'}} onClick={()=>{addToReturn(it);setTab('returns');closeModal();}}>↩️ Return</button>
          <button style={{...S.btn2,fontSize:13,padding:'12px'}} onClick={()=>{closeModal();setTimeout(()=>{setModal({type:'notes',data:it,isSold:false});loadItemNotes(it.id,null);},50);}}>💬 Notes{nc>0?` (${nc})`:''}</button>
          <button style={{...S.btn2,fontSize:13,padding:'12px'}} onClick={()=>{const d=it;closeModal();setTimeout(()=>handleLC(d,false),50);}}>🔄 Timeline</button>
        </div>
      </OL>;})()}

      {/* INVOICE VIEW — 4 tabs */}
      {modal?.type==='invoiceView'&&<OL close={closeModal}>
        <h3 style={S.mT}>{modal.data.auction_house}</h3>
        <p style={{fontSize:13,color:'var(--text-muted)',marginBottom:12}}>{fmtDate(modal.data.date)} · #{modal.data.invoice_number} · <Tag text={modal.data.payment_status||'Due'} ok={modal.data.payment_status==='Paid'}/></p>
        <div style={{display:'flex',gap:6,marginBottom:14}}>
          {[['Lots',modal.data.lot_total],['Premium',modal.data.premium_total],['Tax',modal.data.tax_total],...(parseFloat(modal.data.other_fees_total||0)>0?[['Fees',modal.data.other_fees_total]]:[])].map(([l,v])=><div key={l} style={{flex:1,background:'var(--bg-surface)',borderRadius:10,padding:8,textAlign:'center'}}><p style={{fontSize:9,color:'var(--text-muted)',textTransform:'uppercase'}}>{l}</p><p style={{fontSize:14,fontWeight:700}}>{fmt(v)}</p></div>)}
          <div style={{flex:1,background:'var(--accent-light)',borderRadius:10,padding:8,textAlign:'center'}}><p style={{fontSize:9,color:'var(--accent)',textTransform:'uppercase'}}>Total</p><p style={{fontSize:14,fontWeight:700,color:'var(--accent)'}}>{fmt(modal.data.grand_total)}</p></div>
        </div>
        <div style={S.tabBar}>{[['items','📋 Items'],['photos','📷 Photos'],['print','🖨 Print'],['original','📄 File']].map(([id,lbl])=><button key={id} style={{...S.tabBtn,...(invDetailTab===id?S.tabOn:{})}} onClick={()=>setInvDetailTab(id)}>{lbl}</button>)}</div>

        {invDetailTab==='items'&&(invDetailItems.length===0?<div style={{padding:30,textAlign:'center'}}><div style={S.spin}/></div>:invDetailItems.map((it,idx)=>{const ph=itemPhotos[it.id]||[];return<div key={it.id} className="fade-up" style={{display:'flex',gap:10,padding:'10px 0',borderBottom:'1px solid var(--border-light)',animationDelay:`${idx*15}ms`,alignItems:'center'}}><div style={{width:44,height:44,borderRadius:10,overflow:'hidden',background:'var(--bg-surface)',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>{ph[0]?.url?<img src={ph[0].url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<span style={{color:'var(--text-hint)',fontSize:16}}>📷</span>}</div><div style={{flex:1,minWidth:0}}><p style={{fontSize:14,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{idx+1}. {it.title}</p><p style={{fontSize:12,color:'var(--text-muted)'}}>Lot #{it.lot_number||'—'} · {ph.length} photo{ph.length!==1?'s':''}</p></div><p style={{fontSize:14,fontWeight:700,color:'var(--accent)',flexShrink:0}}>{fmt(it.total_cost)}</p></div>;}))}

        {invDetailTab==='photos'&&(invDetailItems.length===0?<div style={{padding:30,textAlign:'center'}}><div style={S.spin}/></div>:<>{invDetailItems.map((it,idx)=>{const photos=itemPhotos[it.id]||[];const isOpen=invPhotoItemId===it.id;return<div key={it.id} style={{marginBottom:8,borderRadius:12,border:isOpen?'2px solid var(--accent)':'1px solid var(--border)',overflow:'hidden',background:'var(--bg-card)'}}>
          <div style={{display:'flex',gap:10,alignItems:'center',padding:'12px 14px',cursor:'pointer',background:isOpen?'var(--accent-light)':'transparent'}} onClick={()=>{if(isOpen){setInvPhotoItemId(null);setInvPhotoLot('');}else{setInvPhotoItemId(it.id);setInvPhotoLot(it.lot_number||'');}}}>
            <span style={{fontSize:14,color:'var(--accent)'}}>{isOpen?'▾':'▸'}</span>
            <div style={{flex:1}}><p style={{fontSize:13,fontWeight:600}}>{idx+1}. {it.title}</p><p style={{fontSize:11,color:'var(--text-muted)'}}>Lot #{it.lot_number||'—'} · {photos.length} photo{photos.length!==1?'s':''}</p></div>
            {photos[0]?.url&&<div style={{width:34,height:34,borderRadius:8,overflow:'hidden',flexShrink:0}}><img src={photos[0].url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/></div>}
          </div>
          {isOpen&&<div style={{padding:'0 14px 14px'}}>
            <div style={{display:'flex',gap:6,marginBottom:10}}><input style={{...S.inp,flex:1,fontSize:13,padding:'8px 10px'}} placeholder="Lot #" value={invPhotoLot} onChange={e=>setInvPhotoLot(e.target.value)}/><button style={{...S.btn1,padding:'8px 16px',fontSize:12,opacity:invPhotoLot===(it.lot_number||'')?0.4:1}} disabled={invPhotoLot===(it.lot_number||'')} onClick={async()=>{await handleUpdateLotNumber(it.id,invPhotoLot);notify('ok','Lot # saved');}}>Save</button></div>
            <label role="button" style={{...S.btn1,display:'block',textAlign:'center',fontSize:13,padding:10,marginBottom:10,cursor:'pointer'}}><input type="file" accept="image/*" multiple onChange={e=>handleInvItemPhoto(it.id,e)} style={{display:'none'}}/>📷 Upload Photo(s)</label>
            {photos.length>0?<div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6}}>{photos.map((p,pi)=><div key={p.id||pi} style={{position:'relative',aspectRatio:'1',borderRadius:10,overflow:'hidden',background:'var(--bg-surface)'}}>
              {p.url?<img src={p.url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-hint)'}}>...</div>}
              <button onClick={()=>handleDeletePhoto(it.id,p)} style={{position:'absolute',top:4,right:4,width:26,height:26,borderRadius:13,background:'rgba(220,38,38,.9)',color:'#fff',border:'none',fontSize:14,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',boxShadow:'0 2px 6px rgba(0,0,0,.3)'}}>✕</button>
            </div>)}</div>:<p style={{textAlign:'center',color:'var(--text-muted)',fontSize:13,padding:12}}>No photos yet</p>}
          </div>}
        </div>;})}</>)}

        {invDetailTab==='print'&&(invDetailItems.length===0?<div style={{padding:30,textAlign:'center'}}><div style={S.spin}/></div>:<>
          <p style={{fontSize:12,color:'var(--text-muted)',marginBottom:8}}>Select items. "With Details" = 4 per page with full info. "Without" = 3 per page, photo+name+lot only.</p>
          {/* Invoice copy toggle */}
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',background:'var(--bg-surface)',borderRadius:10,marginBottom:10}}>
            <div><p style={{fontSize:13,fontWeight:600}}>📄 Include Invoice Copy</p><p style={{fontSize:11,color:'var(--text-muted)'}}>Adds invoice summary page on top</p></div>
            <button onClick={()=>setPrintIncludeInvoice(!printIncludeInvoice)} style={{width:48,height:28,borderRadius:14,border:'none',background:printIncludeInvoice?'var(--green)':'var(--border)',position:'relative',cursor:'pointer',transition:'background .2s'}}><div style={{width:22,height:22,borderRadius:11,background:'#fff',position:'absolute',top:3,left:printIncludeInvoice?23:3,transition:'left .2s',boxShadow:'0 1px 3px rgba(0,0,0,.2)'}}/></button>
          </div>
          <div style={{display:'flex',gap:8,marginBottom:12}}><button style={{...S.chip,fontWeight:600}} onClick={()=>{const a={};invDetailItems.forEach(it=>{a[it.id]=true;});setInvPrintSelections(a);}}>☑ All</button><button style={S.chip} onClick={()=>setInvPrintSelections({})}>☐ None</button></div>
          {invDetailItems.map(it=>{const ph=itemPhotos[it.id]||[];const on=!!invPrintSelections[it.id];return<div key={it.id} style={{display:'flex',gap:10,alignItems:'center',padding:'10px 0',borderBottom:'1px solid var(--border-light)',cursor:'pointer'}} onClick={()=>setInvPrintSelections(p=>({...p,[it.id]:!p[it.id]}))}>
            <div style={{width:24,height:24,borderRadius:7,border:on?'2px solid var(--accent)':'2px solid var(--border)',background:on?'var(--accent)':'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{on&&<span style={{color:'#fff',fontSize:14,fontWeight:700}}>✓</span>}</div>
            <div style={{width:32,height:32,borderRadius:8,overflow:'hidden',background:'var(--bg-surface)',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>{ph[0]?.url?<img src={ph[0].url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<span style={{fontSize:12,color:'var(--text-hint)'}}>📷</span>}</div>
            <div style={{flex:1,minWidth:0}}><p style={{fontSize:13,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{it.title}</p><p style={{fontSize:11,color:'var(--text-muted)'}}>Lot #{it.lot_number||'—'}</p></div>
            {!ph[0]?.url&&<span style={{fontSize:10,color:'var(--red)',background:'var(--red-light)',padding:'2px 6px',borderRadius:4}}>No photo</span>}
          </div>;})}
          <div style={{marginTop:16,display:'flex',flexDirection:'column',gap:8}}>
            {(()=>{const n=Object.values(invPrintSelections).filter(Boolean).length; const sel=invDetailItems.filter(it=>invPrintSelections[it.id]); return n>0&&<>
              <button style={{...S.btn1,width:'100%'}} onClick={()=>printInvoiceItems(modal.data,sel,true,printIncludeInvoice)}>🖨 Print {n} With Details (4/page)</button>
              <button style={{...S.btn2,width:'100%'}} onClick={()=>printInvoiceItems(modal.data,sel,false,printIncludeInvoice)}>🖨 Print {n} Without Details (3/page)</button>
            </>;})()}
            <button style={{...S.btn2,width:'100%',borderStyle:'dashed'}} onClick={()=>printInvoiceItems(modal.data,invDetailItems,true,printIncludeInvoice)}>🖨 All With Details ({invDetailItems.length})</button>
            <button style={{...S.btn2,width:'100%',borderStyle:'dashed'}} onClick={()=>printInvoiceItems(modal.data,invDetailItems,false,printIncludeInvoice)}>🖨 All Without Details ({invDetailItems.length})</button>
          </div>
        </>)}

        {invDetailTab==='original'&&(!viewInvUrl?<div style={{padding:30,textAlign:'center'}}><div style={S.spin}/></div>:modal.data.file_type?.includes('pdf')?<iframe src={viewInvUrl} style={{width:'100%',height:'55vh',borderRadius:10,border:'1px solid var(--border)'}}/>:<img src={viewInvUrl} alt="" style={{width:'100%',borderRadius:10}}/>)}
        <div style={{display:'flex',gap:8,marginTop:16}}><button style={{...S.btn2,flex:1}} onClick={()=>{handleInvStatus(modal.data,modal.data.payment_status==='Paid'?'Due':'Paid');closeModal();}}>{modal.data.payment_status==='Paid'?'⏳ Mark Due':'✅ Mark Paid'}</button><button style={{...S.btn2,flex:1,color:'var(--red)',borderColor:'var(--red)'}} onClick={()=>{db.deleteItemsByInvoice(modal.data.id).then(()=>db.deleteInvoice(modal.data.id)).then(load);closeModal();}}>🗑 Delete</button></div>
      </OL>}

      {/* ITEM ACTIONS */}
      {modal?.type==='itemActions'&&<OL close={closeModal}>
        <h3 style={S.mT}>{modal.data.title}</h3><p style={{fontSize:13,color:'var(--text-muted)',marginBottom:14}}>Lot #{modal.data.lot_number} · {fmt(modal.data.total_cost)}</p>
        <p style={S.label}>STATUS</p>
        <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:14}}>
          {ITEM_STATUSES.map(st=>{const active=getItemStatus(modal.data)===st.id;return<button key={st.id} style={{padding:'6px 12px',borderRadius:20,border:active?`2px solid ${st.color}`:'1px solid var(--border)',background:active?st.bg:'var(--bg-surface)',fontSize:12,fontFamily:'var(--font)',cursor:'pointer',fontWeight:active?700:400,color:active?st.color:'var(--text-muted)'}} onClick={()=>{if(st.id==='sold'){const d=modal.data;closeModal();setTimeout(()=>{setQuickSellData({price:'',payMethod:'cash',deliveryCharge:''});setModal({type:'quickSell',data:d});},50);}else{setItemPurpose(modal.data,st.id);closeModal();}}}>{st.icon} {st.label}</button>;})}
        </div>
        <div style={{borderTop:'1px solid var(--border)',paddingTop:10}}>
          <MBtn icon="💰" label="Sell" onClick={()=>{closeModal();setTimeout(()=>setModal({type:'sell',data:modal.data}),50);}}/>
          <MBtn icon="📤" label="Share with Customer" onClick={()=>{closeModal();setTimeout(()=>openCustomerShare(modal.data),50);}}/>
          <MBtn icon="💬" label="Notes" onClick={()=>{const d=modal.data;closeModal();setTimeout(()=>{setModal({type:'notes',data:d,isSold:false});loadItemNotes(d.id,null);},50);}}/>
          <MBtn icon="📷" label="Photos" onClick={()=>{const d=modal.data;closeModal();setTimeout(()=>{setModal({type:'photos',data:d});loadPhotos(d.id);},50);}}/>
          <MBtn icon="🔄" label="Timeline" onClick={()=>{const d=modal.data;closeModal();setTimeout(()=>handleLC(d,false),50);}}/>
        </div>
      </OL>}

      {/* NOTES */}
      {modal?.type==='notes'&&<OL close={closeModal}>
        <h3 style={S.mT}>Notes — {modal.data.title}</h3>
        <div style={{background:'var(--bg-surface)',borderRadius:12,padding:14,marginBottom:14}}>
          <p style={{...S.label,marginBottom:6}}>Add Note</p>
          <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:8}}>{NOTE_CATEGORIES.map(cat=><button key={cat.id} onClick={()=>setNoteForm({...noteForm,category:cat.id})} style={{padding:'4px 8px',borderRadius:16,border:noteForm.category===cat.id?`2px solid ${cat.color}`:'1px solid var(--border)',background:noteForm.category===cat.id?cat.bg:'var(--bg-card)',fontSize:10,fontFamily:'var(--font)',cursor:'pointer',color:noteForm.category===cat.id?cat.color:'var(--text-muted)',fontWeight:noteForm.category===cat.id?700:400}}>{cat.icon} {cat.label}</button>)}</div>
          <textarea style={{...S.inp,minHeight:60,resize:'vertical'}} placeholder="Describe the issue..." value={noteForm.note} onChange={e=>setNoteForm({...noteForm,note:e.target.value})}/>
          <button style={{...S.btn1,width:'100%',marginTop:8}} onClick={()=>addNote(modal.isSold?null:modal.data.id,modal.isSold?modal.data.id:null)} disabled={!noteForm.note.trim()}>Add Note</button>
        </div>
        <p style={{...S.label,marginBottom:6}}>History ({itemNotes.length})</p>
        {itemNotes.length===0?<p style={{color:'var(--text-muted)',fontSize:13,textAlign:'center',padding:16}}>No notes</p>:itemNotes.map(note=>{const cat=getCat(note.category);return<div key={note.id} style={{padding:'10px 0',borderBottom:'1px solid var(--border-light)',opacity:note.is_resolved?.5:1}}><div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span style={{fontSize:11,fontWeight:600,color:cat.color,padding:'2px 8px',borderRadius:6,background:cat.bg}}>{cat.icon} {cat.label}</span><span style={{fontSize:10,color:'var(--text-muted)'}}>{fmtTs(note.created_at)}</span></div><p style={{fontSize:14,lineHeight:1.4,textDecoration:note.is_resolved?'line-through':'none'}}>{note.note}</p>{!note.is_resolved&&<div style={{display:'flex',gap:6,marginTop:6}}><button style={{...S.chip,background:'var(--green-light)',color:'var(--green)',fontWeight:600,fontSize:11}} onClick={()=>resolveNote(note.id,modal.isSold?null:modal.data.id,modal.isSold?modal.data.id:null)}>✅ Resolve</button><button style={{...S.chip,color:'var(--red)',fontSize:11}} onClick={()=>deleteNoteById(note.id,modal.isSold?null:modal.data.id,modal.isSold?modal.data.id:null)}>🗑</button></div>}</div>;})}
      </OL>}

      {/* PHOTOS */}
      {modal?.type==='photos'&&<OL close={closeModal}><h3 style={S.mT}>Photos — {modal.data.title}</h3>
        <label role="button" style={{...S.btn1,display:'block',textAlign:'center',marginBottom:14,cursor:'pointer'}}><input type="file" accept="image/*" multiple onChange={e=>handlePhoto(modal.data.id,e)} style={{display:'none'}}/>📷 Upload Photos</label>
        {(itemPhotos[modal.data.id]||[]).length>0?<div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
          {(itemPhotos[modal.data.id]).map((p,i)=><div key={p.id||i} style={{position:'relative',aspectRatio:'1',borderRadius:12,overflow:'hidden',background:'var(--bg-surface)'}}>
            {p.url?<img src={p.url} alt="" style={{width:'100%',height:'100%',objectFit:'cover',cursor:'pointer'}} onClick={()=>setPhotoPreview(p)}/>:<div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-hint)'}}>...</div>}
            <button onClick={()=>handleDeletePhoto(modal.data.id,p)} style={{position:'absolute',top:5,right:5,width:26,height:26,borderRadius:13,background:'rgba(220,38,38,.9)',color:'#fff',border:'none',fontSize:14,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',boxShadow:'0 2px 6px rgba(0,0,0,.3)'}}>✕</button>
          </div>)}
        </div>:<p style={{textAlign:'center',color:'var(--text-muted)',padding:24}}>No photos yet. Tap Upload to add.</p>}
        <p style={{fontSize:11,color:'var(--text-muted)',textAlign:'center',marginTop:10}}>Tap photo to preview & download · Tap ✕ to delete</p>
      </OL>}

      {/* PHOTO PREVIEW — fullscreen with download */}
      {photoPreview&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.85)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',zIndex:999,padding:20}} onClick={()=>setPhotoPreview(null)}>
        <img src={photoPreview.url} alt="" style={{maxWidth:'90%',maxHeight:'70vh',borderRadius:12,objectFit:'contain',boxShadow:'0 4px 20px rgba(0,0,0,.5)'}} onClick={e=>e.stopPropagation()}/>
        <div style={{display:'flex',gap:12,marginTop:16}} onClick={e=>e.stopPropagation()}>
          <button style={{...S.btn1,padding:'12px 24px',fontSize:14}} onClick={()=>{const a=document.createElement('a');a.href=photoPreview.url;a.download=photoPreview.file_name||'photo.jpg';a.target='_blank';a.click();}}>⬇️ Download</button>
          <button style={{...S.btn2,padding:'12px 24px',fontSize:14,color:'#fff',borderColor:'rgba(255,255,255,.3)'}} onClick={()=>setPhotoPreview(null)}>✕ Close</button>
        </div>
      </div>}

      {/* LIST IN STORE */}
      {modal?.type==='listStore'&&<OL close={closeModal}>
        <h3 style={S.mT}>🛒 List in Store</h3>
        <p style={{fontSize:13,color:'var(--text-muted)',marginBottom:12}}>{modal.data.title}</p>
        {(()=>{const ph=(itemPhotos[modal.data.id]||[])[0];return ph?.url?<img src={ph.url} alt="" style={{width:'100%',height:140,objectFit:'cover',borderRadius:12,marginBottom:12}}/>:null;})()}
        <Lbl t="Selling Price *"/>
        <input style={S.inp} type="number" step="0.01" placeholder="Enter price customers will see" value={listStoreData.price} onChange={e=>setListStoreData({...listStoreData,price:e.target.value})} autoFocus/>
        <Lbl t="Description for Customers"/>
        <textarea style={{...S.inp,minHeight:80,resize:'vertical'}} placeholder="Describe the item — condition, dimensions, features..." value={listStoreData.description} onChange={e=>setListStoreData({...listStoreData,description:e.target.value})}/>
        {listStoreData.price&&<div style={{background:'var(--accent-light)',padding:'10px 14px',borderRadius:10,marginTop:10,display:'flex',justifyContent:'space-between'}}>
          <span style={{fontSize:13}}>Customer sees</span>
          <span style={{fontSize:16,fontWeight:800,color:'var(--accent)'}}>${parseFloat(listStoreData.price).toFixed(2)}</span>
        </div>}
        <button style={{...S.btn1,width:'100%',marginTop:14}} onClick={handleListInStore} disabled={!listStoreData.price}>🛒 List in Store</button>
        <p style={{fontSize:11,color:'var(--text-muted)',textAlign:'center',marginTop:8}}>Customers will see this at <b>{window.location.origin}/store</b></p>
      </OL>}

      {/* QUICK SELL — from Sold status chip */}
      {modal?.type==='quickSell'&&<OL close={closeModal}>
        <h3 style={S.mT}>✅ Quick Sell</h3>
        <p style={{fontSize:13,color:'var(--text-muted)',marginBottom:12}}>{modal.data.title} · Cost: {fmt(modal.data.total_cost)}</p>
        {(()=>{const ph=(itemPhotos[modal.data.id]||[])[0];return ph?.url?<img src={ph.url} alt="" style={{width:'100%',height:120,objectFit:'cover',borderRadius:10,marginBottom:12}}/>:null;})()}
        <Lbl t="Sold Price *"/>
        <input style={S.inp} type="number" step="0.01" placeholder="0.00" value={quickSellData.price} onChange={e=>setQuickSellData({...quickSellData,price:e.target.value})} autoFocus/>
        <Lbl t="Payment Method"/>
        <div style={{display:'flex',gap:6,marginBottom:10}}>
          {['cash','interac','credit','other'].map(m=><button key={m} style={{flex:1,padding:'10px',borderRadius:10,border:quickSellData.payMethod===m?'2px solid var(--accent)':'1px solid var(--border)',background:quickSellData.payMethod===m?'var(--accent-light)':'var(--bg-surface)',fontSize:12,fontFamily:'var(--font)',cursor:'pointer',fontWeight:quickSellData.payMethod===m?700:400,color:quickSellData.payMethod===m?'var(--accent)':'var(--text-muted)',textTransform:'capitalize'}} onClick={()=>setQuickSellData({...quickSellData,payMethod:m})}>{m}</button>)}
        </div>
        <Lbl t="Delivery Charge"/>
        <input style={S.inp} type="number" step="0.01" placeholder="0.00 (optional)" value={quickSellData.deliveryCharge} onChange={e=>setQuickSellData({...quickSellData,deliveryCharge:e.target.value})}/>
        {quickSellData.price&&(()=>{const sub=parseFloat(quickSellData.price);const del=parseFloat(quickSellData.deliveryCharge)||0;const total=sub+del;const p=total-parseFloat(modal.data.total_cost);return<div style={{background:p>=0?'var(--green-light)':'var(--red-light)',padding:'12px 14px',borderRadius:10,marginTop:10}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span style={{fontSize:13}}>Price + Delivery</span><span style={{fontSize:14,fontWeight:700}}>{fmt(total)}</span></div>
          <div style={{display:'flex',justifyContent:'space-between'}}><span style={{fontSize:13}}>Profit</span><span style={{fontSize:14,fontWeight:700,color:p>=0?'var(--green)':'var(--red)'}}>{p>=0?'+':''}{fmt(p)}</span></div>
        </div>;})()}
        <button style={{...S.btn1,width:'100%',marginTop:14}} onClick={handleQuickSell} disabled={!quickSellData.price}>✅ Mark as Sold</button>
      </OL>}

      {/* CUSTOMER SHARE — full visual with ALL photos */}
      {modal?.type==='customerShare'&&<OL close={closeModal}>
        <h3 style={S.mT}>📤 Share with Customer</h3>
        <p style={{fontSize:13,color:'var(--text-muted)',marginBottom:10}}>Send product details with all photos and price</p>

        {/* Live preview with ALL photos */}
        {(()=>{const photos=(itemPhotos[modal.data.id]||[]).filter(p=>p.url);return<div style={{background:'var(--bg-surface)',borderRadius:14,padding:12,marginBottom:14}}>
          {photos.length>0?<div style={{display:'flex',gap:6,overflowX:'auto',marginBottom:10,paddingBottom:4}}>
            {photos.map((p,i)=><img key={p.id||i} src={p.url} alt="" style={{width:photos.length===1?'100%':140,height:photos.length===1?'auto':140,minHeight:100,borderRadius:10,objectFit:'cover',flexShrink:0}}/>)}
          </div>:<div style={{width:'100%',height:100,background:'var(--border)',borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-muted)',marginBottom:10}}>No Photos — add photos first</div>}
          <p style={{fontSize:17,fontWeight:700,marginBottom:4}}>{modal.data.title}</p>
          {sharePrice&&<p style={{fontSize:24,fontWeight:800,color:'var(--accent)'}}>${parseFloat(sharePrice).toFixed(2)}</p>}
          <p style={{fontSize:10,color:'var(--text-hint)',marginTop:6}}>Customer will see: photos + name + price only</p>
        </div>;})()}

        {/* Price input */}
        <Lbl t="Asking Price *"/>
        <input style={S.inp} type="number" step="0.01" placeholder="Enter price for customer" value={sharePrice} onChange={e=>setSharePrice(e.target.value)} autoFocus/>

        {/* Share actions */}
        <div style={{display:'flex',flexDirection:'column',gap:8,marginTop:14}}>
          {/* Preview opens full page */}
          <button style={{...S.btn1,width:'100%',fontSize:14,padding:'14px'}} disabled={!sharePrice} onClick={()=>{const html=generateCustomerView(modal.data,sharePrice);const w=window.open('','_blank','width=480,height=800');w.document.write(html);w.document.close();}}>👁 Preview Customer Page</button>

          {/* Share via Web Share API (native share sheet on mobile) */}
          {'share' in navigator && <button style={{...S.btn1,width:'100%',fontSize:14,padding:'14px',background:'var(--green)'}} disabled={!sharePrice} onClick={async()=>{
            const photos=(itemPhotos[modal.data.id]||[]).filter(p=>p.url);
            const text=`${modal.data.title}\nPrice: $${parseFloat(sharePrice).toFixed(2)}`;
            try{
              // Try sharing with image if possible
              if(photos.length>0){try{const resp=await fetch(photos[0].url);const blob=await resp.blob();const file=new File([blob],`${modal.data.title}.jpg`,{type:blob.type||'image/jpeg'});await navigator.share({title:modal.data.title,text:`Price: $${parseFloat(sharePrice).toFixed(2)}`,files:[file]});notify('ok','Shared!');return;}catch(e){}}
              // Fallback: text only share
              await navigator.share({title:modal.data.title,text});notify('ok','Shared!');
            }catch(e){if(e.name!=='AbortError')notify('err','Share failed');}
          }}>📤 Share (WhatsApp, Messenger, Email...)</button>}

          {/* Individual channels */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            <button style={{...S.btn2,fontSize:13,padding:'12px'}} disabled={!sharePrice} onClick={()=>{const text=`${modal.data.title}\nPrice: $${parseFloat(sharePrice).toFixed(2)}`;openWhatsApp('',text);}}>📱 WhatsApp</button>
            <button style={{...S.btn2,fontSize:13,padding:'12px'}} disabled={!sharePrice} onClick={()=>{const text=encodeURIComponent(`${modal.data.title}\nPrice: $${parseFloat(sharePrice).toFixed(2)}`);window.open(`fb-messenger://share?link=${encodeURIComponent('.')}&quote=${text}`,'_blank');notify('ok','Opening Messenger');}}>💬 Messenger</button>
            <button style={{...S.btn2,fontSize:13,padding:'12px'}} disabled={!sharePrice} onClick={()=>{const subj=encodeURIComponent(modal.data.title);const photos=(itemPhotos[modal.data.id]||[]).filter(p=>p.url);const photoLinks=photos.map(p=>`\n📷 ${p.url}`).join('');const body=encodeURIComponent(`${modal.data.title}\nPrice: $${parseFloat(sharePrice).toFixed(2)}\n${photoLinks}`);window.open(`mailto:?subject=${subj}&body=${body}`,'_blank');}}>📧 Email</button>
            <button style={{...S.btn2,fontSize:13,padding:'12px'}} disabled={!sharePrice} onClick={()=>{const text=`${modal.data.title} - $${parseFloat(sharePrice).toFixed(2)}`;openSMS('',text);}}>📩 SMS</button>
          </div>

          {/* Copy with photo links */}
          <button style={{...S.btn2,width:'100%',fontSize:13}} disabled={!sharePrice} onClick={()=>{const photos=(itemPhotos[modal.data.id]||[]).filter(p=>p.url);const photoLinks=photos.map((p,i)=>`Photo ${i+1}: ${p.url}`).join('\n');const text=`${modal.data.title}\nPrice: $${parseFloat(sharePrice).toFixed(2)}${photoLinks?'\n\n'+photoLinks:''}`;navigator.clipboard?.writeText(text);notify('ok','Copied with photo links!');}}>📋 Copy All (text + photo links)</button>
        </div>
      </OL>}

      {/* GO LIVE */}
      {modal?.type==='goLive'&&<OL close={closeModal}><h3 style={S.mT}>List Live — {modal.data.title}</h3><Lbl t="Listing URL"/><div style={{display:'flex',gap:6}}><input style={{...S.inp,flex:1}} type="url" placeholder="https://..." value={sf.listingUrl} onChange={e=>{setSf({...sf,listingUrl:e.target.value});setExtractData(null);}}/><button style={{...S.btn1,padding:'10px 14px',fontSize:13,opacity:(!sf.listingUrl||extractBusy)?.4:1}} disabled={!sf.listingUrl||extractBusy} onClick={async()=>{setExtractBusy(true);setExtractData(null);try{const data=await extractListing(sf.listingUrl);setExtractData(data);if(data.price&&!sf.amount)setSf(p=>({...p,amount:String(data.price)}));if(data.siteName&&!sf.platform){const s=data.siteName.toLowerCase();setSf(p=>({...p,platform:s.includes('facebook')?'Facebook Marketplace':s.includes('kijiji')?'Kijiji':s.includes('ebay')?'eBay':data.siteName}));}notify('ok','Extracted!');}catch(err){notify('err',err.message);}setExtractBusy(false);}}>{extractBusy?'...':'🔍'}</button></div>{extractData&&!extractData.error&&<div style={{background:'var(--bg-surface)',borderRadius:10,padding:12,marginTop:10}}>{extractData.image&&<img src={extractData.image} alt="" style={{width:'100%',height:120,objectFit:'cover',borderRadius:8,marginBottom:8}} onError={e=>{e.target.style.display='none';}}/>}{extractData.title&&<p style={{fontSize:14,fontWeight:600}}>{extractData.title}</p>}{extractData.price&&<p style={{fontSize:16,fontWeight:700,color:'var(--accent)'}}>${extractData.price.toFixed(2)}</p>}</div>}<Lbl t="Platform"/><input style={S.inp} placeholder="Facebook, Kijiji..." value={sf.platform} onChange={e=>setSf({...sf,platform:e.target.value})}/><Lbl t="Asking Price"/><input style={S.inp} type="number" step="0.01" placeholder="0.00" value={sf.amount} onChange={e=>setSf({...sf,amount:e.target.value})}/><button style={{...S.btn1,width:'100%',marginTop:16}} onClick={async()=>{const u={listing_status:'live_listed',listing_platform:sf.platform,listed_at:new Date().toISOString()};if(sf.amount)u.listing_price=parseFloat(sf.amount);if(sf.listingUrl)u.listing_url=sf.listingUrl;await db.updateItem(modal.data.id,u);await db.addLifecycleEvent({item_id:modal.data.id,event:'Listed Live',detail:`${sf.platform||''}${sf.amount?' · $'+sf.amount:''}`});await load();closeModal();notify('ok','Listed!');}}>🟢 Go Live</button></OL>}

      {/* SELL */}
      {modal?.type==='sell'&&<OL close={closeModal}><h3 style={S.mT}>Sell — {modal.data.title}</h3><p style={{fontSize:13,color:'var(--text-muted)',marginBottom:10}}>Cost: {fmt(modal.data.total_cost)}</p><Lbl t="Amount *"/><input style={S.inp} type="number" step="0.01" value={sf.amount} onChange={e=>setSf({...sf,amount:e.target.value})} autoFocus/><Lbl t="Platform"/><input style={S.inp} value={sf.platform} onChange={e=>setSf({...sf,platform:e.target.value})}/><Lbl t="Buyer"/><input style={S.inp} value={sf.buyer} onChange={e=>setSf({...sf,buyer:e.target.value})}/><Lbl t="Email"/><input style={S.inp} type="email" value={sf.buyerEmail} onChange={e=>setSf({...sf,buyerEmail:e.target.value})}/><Lbl t="Phone"/><input style={S.inp} type="tel" value={sf.buyerPhone} onChange={e=>setSf({...sf,buyerPhone:e.target.value})}/><Lbl t="Payment"/><div style={{display:'flex',gap:8,marginBottom:10}}><button style={{...S.togBtn,...(sf.billStatus==='paid'?S.togOn:{})}} onClick={()=>setSf({...sf,billStatus:'paid'})}>✅ Paid</button><button style={{...S.togBtn,...(sf.billStatus==='due'?{...S.togOn,background:'var(--red-light)',color:'var(--red)',borderColor:'var(--red)'}:{})}} onClick={()=>setSf({...sf,billStatus:'due'})}>⏳ Due</button></div><HstTog sf={sf} setSf={setSf}/>{sf.amount&&(()=>{const sub=parseFloat(sf.amount);const tax=sf.includeHst?+(sub*.13).toFixed(2):0;const p=(sub+tax)-parseFloat(modal.data.total_cost);return<div style={{background:p>=0?'var(--green-light)':'var(--red-light)',padding:'10px 14px',borderRadius:10,marginTop:8,display:'flex',justifyContent:'space-between'}}><span>Profit</span><span style={{fontWeight:700,color:p>=0?'var(--green)':'var(--red)'}}>{p>=0?'+':''}{fmt(p)}</span></div>;})()}<button style={{...S.btn1,width:'100%',marginTop:16}} onClick={handleSell} disabled={!sf.amount}>Confirm & Generate Bill</button></OL>}

      {/* BILL OF SALE */}
      {modal?.type==='billOfSale'&&<OL close={closeModal}><h3 style={S.mT}>Bill of Sale</h3><Lbl t="Search Items"/><input style={S.inp} placeholder="Search..." value={billSearch} onChange={e=>setBillSearch(e.target.value)}/>{billSearch&&<div style={{maxHeight:150,overflow:'auto',border:'1px solid var(--border)',borderRadius:10,marginTop:4,marginBottom:8}}>{items.filter(i=>i.purpose!=='personal'&&!billItems.find(b=>b.id===i.id)&&[i.title,i.lot_number].some(f=>f?.toLowerCase().includes(billSearch.toLowerCase()))).map(i=><div key={i.id} style={{padding:'10px 14px',borderBottom:'1px solid var(--border-light)',cursor:'pointer',display:'flex',justifyContent:'space-between'}} onClick={()=>{setBillItems(p=>[...p,{...i,sellPrice:''}]);setBillSearch('');}}><span style={{fontSize:13}}>{i.title}</span><span style={{fontSize:12,color:'var(--text-muted)'}}>{fmt(i.total_cost)}</span></div>)}</div>}{billItems.length>0&&<div style={{marginBottom:12}}><p style={{...S.label,marginBottom:6}}>Items ({billItems.length})</p>{billItems.map((bi,idx)=><div key={bi.id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 0',borderBottom:'1px solid var(--border-light)'}}><div style={{flex:1,minWidth:0}}><p style={{fontSize:13,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{bi.title}</p></div><input style={{...S.inp,width:100,padding:'6px 8px',textAlign:'right'}} type="number" step="0.01" placeholder="Price" value={bi.sellPrice} onChange={e=>setBillItems(p=>p.map((b,i)=>i===idx?{...b,sellPrice:e.target.value}:b))}/><button style={{background:'none',border:'none',color:'var(--red)',fontSize:16,cursor:'pointer'}} onClick={()=>setBillItems(p=>p.filter((_,i)=>i!==idx))}>✕</button></div>)}{(()=>{const sub=billItems.reduce((s,i)=>s+(parseFloat(i.sellPrice)||0),0);const tax=sf.includeHst?+(sub*.13).toFixed(2):0;return<div style={{padding:'10px 0',display:'flex',justifyContent:'space-between',fontSize:16,fontWeight:700,color:'var(--accent)'}}><span>Total</span><span>{fmt(sub+tax)}</span></div>;})()}</div>}<Lbl t="Buyer *"/><input style={S.inp} value={sf.buyer} onChange={e=>setSf({...sf,buyer:e.target.value})}/><Lbl t="Email"/><input style={S.inp} type="email" value={sf.buyerEmail} onChange={e=>setSf({...sf,buyerEmail:e.target.value})}/><Lbl t="Phone"/><input style={S.inp} type="tel" value={sf.buyerPhone} onChange={e=>setSf({...sf,buyerPhone:e.target.value})}/><Lbl t="Payment"/><div style={{display:'flex',gap:8,marginBottom:8}}><button style={{...S.togBtn,...(sf.billStatus==='paid'?S.togOn:{})}} onClick={()=>setSf({...sf,billStatus:'paid'})}>✅ Paid</button><button style={{...S.togBtn,...(sf.billStatus==='due'?{...S.togOn,background:'var(--red-light)',color:'var(--red)',borderColor:'var(--red)'}:{})}} onClick={()=>setSf({...sf,billStatus:'due'})}>⏳ Due</button></div><HstTog sf={sf} setSf={setSf}/><button style={{...S.btn1,width:'100%',marginTop:12}} onClick={handleBillOfSale} disabled={!billItems.length||!sf.buyer||billItems.some(b=>!b.sellPrice)}>Generate Bill</button></OL>}

      {/* BILL PREVIEW */}
      {modal?.type==='billPreview'&&<OL close={closeModal}><h3 style={S.mT}>Bill — {modal.data.receipt_number}</h3><Tag text={modal.data.bill_status==='due'?'Due':'Paid'} ok={modal.data.bill_status!=='due'}/><div style={{background:'#fff',borderRadius:10,maxHeight:'40vh',overflow:'auto',margin:'12px 0',border:'1px solid var(--border)'}} dangerouslySetInnerHTML={{__html:billHtml||modal.data.receipt_html}}/><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}><button style={S.btn1} onClick={()=>printHTML(billHtml||modal.data.receipt_html)}>🖨 Print</button><button style={S.btn2} onClick={()=>{setEmailTo(modal.data.sold_buyer_email||'');setModal({type:'email',data:modal.data});}}>📧 Email</button><button style={S.btn2} onClick={()=>openWhatsApp(modal.data.sold_buyer_phone,`Bill #${modal.data.receipt_number}\n${buildReceiptText(modal.data,{name:biz.business_name,phone:biz.phone})}`)}>📱 WhatsApp</button><button style={S.btn2} onClick={()=>{navigator.clipboard?.writeText(`Bill #${modal.data.receipt_number}\n${buildReceiptText(modal.data,{name:biz.business_name,address:biz.address,phone:biz.phone})}`);notify('ok','Copied');}}>📋 Copy</button></div>{modal.data.bill_status==='due'&&<button style={{...S.btn1,width:'100%',marginTop:10,background:'var(--green)'}} onClick={()=>{markBillPaid(modal.data);closeModal();}}>✅ Mark Paid</button>}</OL>}

      {modal?.type==='receipt'&&<OL close={closeModal}><h3 style={S.mT}>Receipt</h3>{receiptBusy?<div style={{textAlign:'center',padding:30}}><div style={S.spin}/></div>:<div><div style={{background:'#fff',borderRadius:10,maxHeight:'40vh',overflow:'auto',marginBottom:12,border:'1px solid var(--border)'}} dangerouslySetInnerHTML={{__html:receiptHtml}}/><button style={S.btn1} onClick={()=>printHTML(receiptHtml)}>🖨 Print</button></div>}</OL>}
      {modal?.type==='share'&&<OL close={closeModal}><h3 style={S.mT}>Share</h3><MBtn icon="🧾" label="View Bill" onClick={()=>{closeModal();setTimeout(()=>viewBill(modal.data),50);}}/><MBtn icon="📧" label="Email" onClick={()=>{setEmailTo(modal.data.sold_buyer_email||'');setModal({type:'email',data:modal.data});}}/><MBtn icon="📱" label="WhatsApp" onClick={()=>openWhatsApp(modal.data.sold_buyer_phone,buildReceiptText(modal.data,{name:biz.business_name,phone:biz.phone}))}/><MBtn icon="📋" label="Copy" onClick={()=>{navigator.clipboard?.writeText(buildReceiptText(modal.data,{name:biz.business_name,address:biz.address,phone:biz.phone}));notify('ok','Copied');closeModal();}}/></OL>}
      {modal?.type==='email'&&<OL close={closeModal}><h3 style={S.mT}>Email</h3><Lbl t="To"/><input style={S.inp} type="email" value={emailTo} onChange={e=>setEmailTo(e.target.value)} autoFocus/><button style={{...S.btn1,width:'100%',marginTop:14}} onClick={handleEmail} disabled={!emailTo}>Send</button></OL>}

      {modal?.type==='editSold'&&<OL close={closeModal}><h3 style={S.mT}>Edit — {modal.data.title}</h3><p style={{fontSize:13,color:'var(--text-muted)',marginBottom:8}}>Cost: {fmt(modal.data.total_cost)} · {modal.data.receipt_number}</p><Lbl t="Amount"/><input style={S.inp} type="number" step="0.01" value={sf.amount} onChange={e=>setSf({...sf,amount:e.target.value})} autoFocus/><Lbl t="Platform"/><input style={S.inp} value={sf.platform} onChange={e=>setSf({...sf,platform:e.target.value})}/><Lbl t="Buyer"/><input style={S.inp} value={sf.buyer} onChange={e=>setSf({...sf,buyer:e.target.value})}/><Lbl t="Email"/><input style={S.inp} type="email" value={sf.buyerEmail} onChange={e=>setSf({...sf,buyerEmail:e.target.value})}/><Lbl t="Phone"/><input style={S.inp} type="tel" value={sf.buyerPhone} onChange={e=>setSf({...sf,buyerPhone:e.target.value})}/><Lbl t="Payment"/><div style={{display:'flex',gap:8,marginBottom:8}}><button style={{...S.togBtn,...(sf.billStatus==='paid'?S.togOn:{})}} onClick={()=>setSf({...sf,billStatus:'paid'})}>✅ Paid</button><button style={{...S.togBtn,...(sf.billStatus==='due'?{...S.togOn,background:'var(--red-light)',color:'var(--red)',borderColor:'var(--red)'}:{})}} onClick={()=>setSf({...sf,billStatus:'due'})}>⏳ Due</button></div>{sf.amount&&(()=>{const p=parseFloat(sf.amount)-parseFloat(modal.data.total_cost);return<div style={{background:p>=0?'var(--green-light)':'var(--red-light)',padding:'10px 14px',borderRadius:10,display:'flex',justifyContent:'space-between'}}><span>Profit</span><span style={{fontWeight:700,color:p>=0?'var(--green)':'var(--red)'}}>{p>=0?'+':''}{fmt(p)}</span></div>;})()}<button style={{...S.btn1,width:'100%',marginTop:14}} onClick={handleEditSold} disabled={!sf.amount}>Save Changes</button><button style={{...S.btn2,width:'100%',marginTop:8,color:'var(--blue)'}} onClick={()=>{closeModal();returnToInventory(modal.data);}}>↩ Return to Inventory</button></OL>}

      {modal?.type==='lc'&&<OL close={closeModal}><h3 style={S.mT}>Timeline</h3><div style={{borderLeft:'2px solid var(--border)',marginLeft:6,paddingLeft:16,marginTop:10}}>{lcEvents.map((ev,i)=><div key={ev.id} style={{paddingBottom:14,position:'relative'}}><div style={{position:'absolute',left:-22,top:4,width:10,height:10,borderRadius:5,background:i===lcEvents.length-1?'var(--accent)':'var(--border)'}}/><p style={{fontSize:14,fontWeight:600}}>{ev.event}</p><p style={{fontSize:11,color:'var(--text-muted)'}}>{fmtTs(ev.created_at)}</p>{ev.detail&&<p style={{fontSize:12,color:'var(--text-secondary)'}}>{ev.detail}</p>}</div>)}</div></OL>}
    </div>
  );
}

function OL({close,children}){return<div style={S.overlay} onClick={close}><div className="slide-up" style={S.sheet} onClick={e=>e.stopPropagation()}><div style={S.handle}/>{children}</div></div>;}
function Tag({text,ok,color,bg}){return<span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:6,background:bg||(ok?'var(--green-light)':'var(--red-light)'),color:color||(ok?'var(--green)':'var(--red)'),display:'inline-block'}}>{text}</span>;}
function Empty({text}){return<div style={{textAlign:'center',padding:40}}><p style={{fontSize:36,marginBottom:8}}>📭</p><p style={{fontSize:14,color:'var(--text-muted)'}}>{text}</p></div>;}
function Lbl({t}){return<label style={S.label}>{t}</label>;}
function MBtn({icon,label,onClick,color}){return<button style={{display:'flex',alignItems:'center',gap:12,width:'100%',padding:'14px 16px',background:'var(--bg-surface)',border:'none',borderRadius:10,fontSize:15,fontFamily:'var(--font)',marginBottom:6,textAlign:'left',cursor:'pointer',color:color||'var(--text)'}} onClick={onClick}><span style={{fontSize:18}}>{icon}</span>{label}</button>;}
function HstTog({sf,setSf}){return<div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',background:'var(--bg-surface)',borderRadius:10,marginBottom:8}}><div><p style={{fontSize:14,fontWeight:500}}>Include HST (13%)</p><p style={{fontSize:11,color:'var(--text-muted)'}}>Add tax to bill</p></div><button onClick={()=>setSf({...sf,includeHst:!sf.includeHst})} style={{width:48,height:28,borderRadius:14,border:'none',background:sf.includeHst?'var(--green)':'var(--border)',position:'relative',cursor:'pointer',transition:'background .2s'}}><div style={{width:22,height:22,borderRadius:11,background:'#fff',position:'absolute',top:3,left:sf.includeHst?23:3,transition:'left .2s',boxShadow:'0 1px 3px rgba(0,0,0,.2)'}}/></button></div>;}
function SC({si,i,onBill,onShare,onLC,onNote,onMarkPaid,onEdit,onReturn,noteCount,photoUrl}){const p=parseFloat(si.profit);return<div className="fade-up" style={{...S.card,marginBottom:8,animationDelay:`${i*20}ms`,...(noteCount>0?{borderLeft:'3px solid #F59E0B'}:{})}}>
  <div style={{display:'flex',gap:12,padding:'14px 16px',alignItems:'center'}}>
    <div style={{width:48,height:48,borderRadius:12,overflow:'hidden',background:si.bill_status==='due'?'var(--red-light)':'var(--green-light)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>
      {photoUrl?<img src={photoUrl} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<span>{si.bill_status==='due'?'⏳':'✅'}</span>}
    </div>
    <div style={{flex:1,minWidth:0}}>
      <p style={{fontSize:14,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{si.title}</p>
      <p style={{fontSize:12,color:'var(--text-muted)'}}>{si.sold_buyer||'Walk-in'} · {fmtTs(si.sold_at)}</p>
      <Tag text={si.bill_status==='due'?'Due':'Paid'} ok={si.bill_status!=='due'}/>
    </div>
    <div style={{textAlign:'right',flexShrink:0}}>
      <p style={{fontSize:15,fontWeight:700}}>{fmt(si.sold_price)}</p>
      <p style={{fontSize:12,fontWeight:700,color:p>=0?'var(--green)':'var(--red)'}}>{p>=0?'+':''}{fmt(si.profit)}</p>
    </div>
  </div>
  <div style={S.acts}>{onMarkPaid&&<button style={{...S.chip,background:'var(--green-light)',color:'var(--green)',fontWeight:700}} onClick={onMarkPaid}>✅ Paid</button>}<button style={{...S.chip,background:'var(--accent-light)',color:'var(--accent)',fontWeight:700}} onClick={onBill}>🧾</button>{onEdit&&<button style={S.chip} onClick={onEdit}>✏️</button>}{onReturn&&<button style={S.chip} onClick={onReturn}>↩️</button>}<button style={S.chip} onClick={onNote}>💬{noteCount>0?` ${noteCount}`:''}</button><button style={S.chip} onClick={onShare}>📤</button><button style={S.chip} onClick={onLC}>🔄</button></div>
</div>;}

const S={shell:{display:'flex',flexDirection:'column',height:'100%',background:'var(--bg)'},center:{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100vh',background:'var(--bg)'},main:{flex:1,overflow:'auto',padding:'0 16px 80px'},hdr:{padding:'18px 0 14px'},secT:{fontSize:16,fontWeight:700,margin:'14px 0 10px'},card:{background:'var(--bg-card)',borderRadius:14,boxShadow:'var(--shadow-sm)',overflow:'hidden'},qAct:{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,padding:'22px 12px',background:'var(--bg-card)',borderRadius:14,border:'2px dashed var(--border)',cursor:'pointer',textAlign:'center',boxShadow:'var(--shadow-sm)'},inp:{width:'100%',padding:'12px 14px',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:10,fontSize:15,color:'var(--text)',fontFamily:'var(--font)',boxSizing:'border-box',outline:'none'},label:{display:'block',fontSize:11,fontWeight:600,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:.3,margin:'10px 0 4px'},btn1:{padding:'14px 24px',background:'var(--accent)',color:'#fff',border:'none',borderRadius:12,fontSize:15,fontWeight:700,fontFamily:'var(--font)',textAlign:'center',cursor:'pointer'},btn2:{padding:'12px 16px',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,fontSize:14,color:'var(--text)',fontFamily:'var(--font)',textAlign:'center',cursor:'pointer'},chip:{padding:'7px 12px',background:'var(--bg-surface)',border:'none',borderRadius:20,fontSize:12,color:'var(--text-secondary)',fontFamily:'var(--font)',cursor:'pointer'},acts:{display:'flex',gap:6,padding:'8px 14px',borderTop:'1px solid var(--border-light)',flexWrap:'wrap'},togBtn:{flex:1,padding:'10px',borderRadius:10,border:'1px solid var(--border)',background:'var(--bg-surface)',fontSize:14,fontFamily:'var(--font)',textAlign:'center',cursor:'pointer',color:'var(--text-secondary)'},togOn:{background:'var(--accent-light)',color:'var(--accent)',borderColor:'var(--accent)',fontWeight:700},pills:{display:'flex',gap:6,overflowX:'auto',marginBottom:12,paddingBottom:2},pill:{padding:'8px 16px',borderRadius:22,border:'1px solid var(--border)',background:'var(--bg-card)',fontSize:13,color:'var(--text-secondary)',whiteSpace:'nowrap',fontFamily:'var(--font)',cursor:'pointer',fontWeight:500},pillOn:{background:'var(--accent)',color:'#fff',borderColor:'var(--accent)',fontWeight:700},thumb:{width:52,height:52,borderRadius:12,overflow:'hidden',flexShrink:0,background:'var(--bg-surface)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',border:'1px solid var(--border-light)'},thumbImg:{width:'100%',height:'100%',objectFit:'cover'},nav:{display:'flex',justifyContent:'space-around',background:'var(--bg-card)',borderTop:'1px solid var(--border)',position:'fixed',bottom:0,left:0,right:0,zIndex:50,paddingBottom:'env(safe-area-inset-bottom, 0px)'},navBtn:{display:'flex',flexDirection:'column',alignItems:'center',gap:1,padding:'8px 0',minWidth:50,background:'none',border:'none',fontFamily:'var(--font)',position:'relative',cursor:'pointer'},badge:{position:'absolute',top:0,right:2,background:'var(--accent)',color:'#fff',fontSize:8,fontWeight:700,padding:'1px 4px',borderRadius:10,minWidth:14,textAlign:'center'},overlay:{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',display:'flex',alignItems:'flex-end',justifyContent:'center',zIndex:100},sheet:{background:'var(--bg-card)',borderRadius:'20px 20px 0 0',padding:'8px 20px 28px',width:'100%',maxWidth:500,maxHeight:'88vh',overflow:'auto'},handle:{width:36,height:4,background:'var(--border)',borderRadius:4,margin:'0 auto 16px'},mT:{fontSize:18,fontWeight:700,marginBottom:4},tabBar:{display:'flex',gap:0,marginBottom:14,border:'1px solid var(--border)',borderRadius:12,overflow:'hidden'},tabBtn:{flex:1,padding:'10px 0',border:'none',background:'var(--bg-surface)',fontSize:12,fontFamily:'var(--font)',cursor:'pointer',color:'var(--text-muted)',textAlign:'center',fontWeight:500},tabOn:{background:'var(--accent)',color:'#fff',fontWeight:700},spin:{width:28,height:28,border:'3px solid var(--border)',borderTopColor:'var(--accent)',borderRadius:'50%',animation:'spin .8s linear infinite'},miniSpin:{width:14,height:14,border:'2px solid rgba(255,255,255,.4)',borderTopColor:'#fff',borderRadius:'50%',animation:'spin .6s linear infinite',flexShrink:0,marginRight:8},toast:{position:'fixed',top:12,left:16,right:16,padding:'12px 16px',borderRadius:14,color:'#fff',fontSize:14,fontWeight:600,display:'flex',alignItems:'center',zIndex:999,boxShadow:'0 4px 16px rgba(0,0,0,.2)'},fullOL:{position:'fixed',inset:0,background:'rgba(0,0,0,.6)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',zIndex:300}};
