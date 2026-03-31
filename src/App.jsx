import { useState, useEffect, useCallback, useRef } from 'react';
import * as db from './utils/db';
import { parseInvoiceAI, generateReceiptAI, sendEmailFallback } from './utils/api';
import { uid, fmt, fmtDate, fmtTs, readFileAsBase64, openWhatsApp, openSMS, printHTML, buildReceiptText } from './utils/helpers';

const TABS = [
  { id: 'upload', icon: '⬆', label: 'Upload' },
  { id: 'invoices', icon: '📋', label: 'Invoices' },
  { id: 'inventory', icon: '📦', label: 'Stock' },
  { id: 'sold', icon: '✅', label: 'Sold' },
  { id: 'more', icon: '⋯', label: 'More' },
];

export default function App() {
  const [authState, setAuthState] = useState('loading'); // loading, login, app
  const [user, setUser] = useState(null);
  const [authForm, setAuthForm] = useState({ email: '', password: '', mode: 'login' });
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const [tab, setTab] = useState('upload');
  const [subTab, setSubTab] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [items, setItems] = useState([]);
  const [sold, setSold] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [biz, setBiz] = useState({ business_name: '', address: '', phone: '', email: '', hst: '' });
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState('');

  const [sellModal, setSellModal] = useState(null);
  const [imgModal, setImgModal] = useState(null);
  const [receiptModal, setReceiptModal] = useState(null);
  const [receiptHtml, setReceiptHtml] = useState('');
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [shareModal, setShareModal] = useState(null);
  const [emailModal, setEmailModal] = useState(null);
  const [emailTo, setEmailTo] = useState('');
  const [viewInvModal, setViewInvModal] = useState(null);
  const [viewInvUrl, setViewInvUrl] = useState(null);
  const [lcItem, setLcItem] = useState(null);
  const [lcEvents, setLcEvents] = useState([]);
  const [itemPhotos, setItemPhotos] = useState({});

  const [sf, setSf] = useState({ amount: '', platform: '', buyer: '', buyerEmail: '', buyerPhone: '' });
  const fileRef = useRef(null);

  const showToast = useCallback((type, msg) => { setToast({ type, msg }); setTimeout(() => setToast(null), 4000); }, []);

  // ─── Auth ───
  useEffect(() => {
    const { data: { subscription } } = db.onAuthChange((event, session) => {
      if (session?.user) { setUser(session.user); setAuthState('app'); }
      else { setUser(null); setAuthState('login'); }
    });
    db.getUser().then(u => { if (u) { setUser(u); setAuthState('app'); } else setAuthState('login'); });
    return () => subscription.unsubscribe();
  }, []);

  const handleAuth = useCallback(async () => {
    setAuthLoading(true); setAuthError('');
    try {
      if (authForm.mode === 'login') await db.signIn(authForm.email, authForm.password);
      else { await db.signUp(authForm.email, authForm.password); showToast('success', 'Check your email to confirm!'); }
    } catch (err) { setAuthError(err.message); }
    setAuthLoading(false);
  }, [authForm, showToast]);

  // ─── Load Data ───
  const loadAll = useCallback(async () => {
    try {
      const [inv, itm, sld, cust, settings] = await Promise.all([
        db.getInvoices(), db.getItems(), db.getSoldItems(), db.getCustomers(), db.getSettings()
      ]);
      setInvoices(inv); setItems(itm); setSold(sld); setCustomers(cust);
      if (settings) setBiz(settings);
    } catch (err) { console.error('Load error:', err); }
  }, []);

  useEffect(() => { if (authState === 'app') loadAll(); }, [authState, loadAll]);

  // ─── Load photos for an item ───
  const loadPhotos = useCallback(async (itemId, soldItemId) => {
    const photos = await db.getPhotoUrls(itemId || null, soldItemId || null);
    setItemPhotos(p => ({ ...p, [itemId || soldItemId]: photos }));
    return photos;
  }, []);

  // ─── Upload Invoice ───
  const handleUpload = useCallback(async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    showToast('info', `Analyzing "${file.name}"...`);
    try {
      const b64 = await readFileAsBase64(file);
      const result = await parseInvoiceAI(b64, file.type);

      // Upload original file to Supabase Storage
      const invId = undefined; // Let Supabase generate UUID
      const tempId = uid();
      const filePath = await db.uploadInvoiceFile(tempId, b64, file.name, file.type);

      // Insert invoice
      const newInv = await db.insertInvoice({
        date: result.invoice.date, auction_house: result.invoice.auction_house,
        invoice_number: result.invoice.invoice_number, event_description: result.invoice.event_description,
        payment_method: result.invoice.payment_method, payment_status: result.invoice.payment_status,
        pickup_location: result.invoice.pickup_location, buyer_premium_rate: result.invoice.buyer_premium_rate,
        tax_rate: result.invoice.tax_rate, lot_total: result.invoice.lot_total,
        premium_total: result.invoice.premium_total, tax_total: result.invoice.tax_total,
        grand_total: result.invoice.grand_total, file_name: file.name, file_type: file.type,
        file_path: filePath, item_count: result.items.length
      });

      // Insert items
      const pr = result.invoice.buyer_premium_rate || 0;
      const tr = result.invoice.tax_rate || 0.13;
      const newItems = result.items.map(item => ({
        invoice_id: newInv.id, lot_number: item.lot_number, title: item.title,
        description: item.description, quantity: item.quantity || 1, hammer_price: item.hammer_price,
        premium_rate: pr, tax_rate: tr,
        premium_amount: +(item.hammer_price * pr).toFixed(2),
        subtotal: +(item.hammer_price * (1 + pr)).toFixed(2),
        tax_amount: +(item.hammer_price * (1 + pr) * tr).toFixed(2),
        total_cost: +(item.hammer_price * (1 + pr) * (1 + tr)).toFixed(2),
        auction_house: result.invoice.auction_house, date: result.invoice.date,
        pickup_location: result.invoice.pickup_location, payment_method: result.invoice.payment_method,
        status: 'in_inventory'
      }));
      const inserted = await db.insertItems(newItems);

      // Add lifecycle events
      const now = new Date().toISOString();
      const lcEvents = inserted.flatMap(item => [
        { item_id: item.id, event: 'Invoice Uploaded', detail: file.name, created_at: now },
        { item_id: item.id, event: 'AI Extraction', detail: `${result.items.length} items from ${result.invoice.auction_house}`, created_at: now },
        { item_id: item.id, event: 'Added to Inventory', detail: `Lot #${item.lot_number}`, created_at: now },
      ]);
      await db.addLifecycleEvents(lcEvents);

      await loadAll();
      showToast('success', `${result.items.length} items from "${result.invoice.auction_house}"`);
    } catch (err) { console.error(err); showToast('error', err.message); }
    if (fileRef.current) fileRef.current.value = '';
  }, [showToast, loadAll]);

  // ─── View Original Invoice ───
  const handleViewInvoice = useCallback(async (inv) => {
    setViewInvModal(inv); setViewInvUrl(null);
    if (inv.file_path) {
      const url = await db.getInvoiceFileUrl(inv.file_path);
      setViewInvUrl(url);
    }
  }, []);

  // ─── Photo Upload ───
  const handlePhotoUpload = useCallback(async (itemId, e) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      await db.uploadPhoto(itemId, file);
      await db.addLifecycleEvent({ item_id: itemId, event: 'Photo Added', detail: file.name });
    }
    await loadPhotos(itemId);
    setImgModal(null);
    showToast('success', `${files.length} photo(s) uploaded`);
  }, [loadPhotos, showToast]);

  // ─── Sell ───
  const handleSell = useCallback(async () => {
    if (!sellModal || !sf.amount) return;
    const amount = parseFloat(sf.amount); if (isNaN(amount)) return;
    const item = items.find(i => i.id === sellModal); if (!item) return;
    const rcpt = `RCP-${Date.now().toString(36).toUpperCase()}`;
    const profit = +(amount - item.total_cost).toFixed(2);
    const profitPct = item.total_cost > 0 ? +(((amount - item.total_cost) / item.total_cost) * 100).toFixed(1) : 0;

    const soldData = {
      item_id: item.id, invoice_id: item.invoice_id, lot_number: item.lot_number,
      title: item.title, description: item.description, quantity: item.quantity,
      hammer_price: item.hammer_price, premium_rate: item.premium_rate, tax_rate: item.tax_rate,
      premium_amount: item.premium_amount, subtotal: item.subtotal, tax_amount: item.tax_amount,
      total_cost: item.total_cost, auction_house: item.auction_house, date: item.date,
      pickup_location: item.pickup_location, payment_method: item.payment_method,
      sold_price: amount, sold_platform: sf.platform, sold_buyer: sf.buyer,
      sold_buyer_email: sf.buyerEmail, sold_buyer_phone: sf.buyerPhone,
      receipt_number: rcpt, profit, profit_pct: profitPct
    };

    const soldItem = await db.insertSoldItem(soldData);
    await db.deleteItem(item.id);

    // Copy lifecycle events and add sale event
    const oldLc = await db.getLifecycle(item.id, null);
    if (oldLc.length) {
      await db.addLifecycleEvents(oldLc.map(e => ({ sold_item_id: soldItem.id, event: e.event, detail: e.detail, created_at: e.created_at })));
    }
    await db.addLifecycleEvent({ sold_item_id: soldItem.id, event: 'Sold', detail: `${fmt(amount)}${sf.platform ? ` via ${sf.platform}` : ''}${sf.buyer ? ` to ${sf.buyer}` : ''} • ${rcpt}` });

    // Copy photos to sold item
    const photos = await db.getPhotoUrls(item.id, null);
    // Photos stay in storage, we just need to update references if needed

    if (sf.buyer && !customers.find(c => c.name === sf.buyer)) {
      await db.insertCustomer({ name: sf.buyer, email: sf.buyerEmail, phone: sf.buyerPhone });
    }

    await loadAll();
    setSellModal(null); setSf({ amount: '', platform: '', buyer: '', buyerEmail: '', buyerPhone: '' });
    showToast('success', `Sold! Receipt #${rcpt}`);
  }, [sellModal, sf, items, customers, loadAll, showToast]);

  // ─── Receipt ───
  const handleGenReceipt = useCallback(async (si) => {
    setReceiptModal(si.id); setReceiptLoading(true); setReceiptHtml('');
    try {
      const bizForReceipt = { name: biz.business_name, address: biz.address, phone: biz.phone, email: biz.email, hst: biz.hst };
      const html = await generateReceiptAI(si, bizForReceipt, { name: si.sold_buyer || 'Walk-in Customer', email: si.sold_buyer_email || '', phone: si.sold_buyer_phone || '' });
      setReceiptHtml(html);
      await db.updateSoldItem(si.id, { receipt_html: html });
      await db.addLifecycleEvent({ sold_item_id: si.id, event: 'Receipt Generated', detail: si.receipt_number });
      await loadAll();
    } catch (err) { showToast('error', err.message); setReceiptModal(null); }
    setReceiptLoading(false);
  }, [biz, loadAll, showToast]);

  // ─── Email ───
  const handleEmail = useCallback(async () => {
    if (!emailTo || !shareModal) return;
    const si = sold.find(i => i.id === shareModal);
    if (!si) return;
    const bizForText = { name: biz.business_name, address: biz.address, phone: biz.phone, email: biz.email };
    sendEmailFallback(emailTo, `Receipt #${si.receipt_number} from ${biz.business_name}`, buildReceiptText(si, bizForText));
    await db.addLifecycleEvent({ sold_item_id: si.id, event: 'Emailed', detail: emailTo });
    showToast('success', `Opening email to ${emailTo}`);
    setEmailModal(null); setEmailTo(''); setShareModal(null);
  }, [emailTo, shareModal, sold, biz, showToast]);

  // ─── Delete Invoice ───
  const handleDeleteInvoice = useCallback(async (invId) => {
    if (!confirm('Delete this invoice and its items?')) return;
    await db.deleteItemsByInvoice(invId);
    await db.deleteInvoice(invId);
    await loadAll();
    showToast('success', 'Deleted');
  }, [loadAll, showToast]);

  // ─── Settings ───
  const saveBiz = useCallback(async () => {
    await db.upsertSettings(biz);
    showToast('success', 'Saved');
  }, [biz, showToast]);

  // ─── Lifecycle View ───
  const viewLifecycle = useCallback(async (item, isSold) => {
    setLcItem(item); setSubTab('lifecycle');
    const events = await db.getLifecycle(isSold ? null : item.id, isSold ? item.id : null);
    setLcEvents(events);
    if (!isSold) await loadPhotos(item.id);
  }, [loadPhotos]);

  // ─── Reset ───
  const handleReset = useCallback(async () => {
    if (!confirm('Delete ALL data permanently?')) return;
    await db.clearAllData();
    await loadAll();
    showToast('success', 'All data cleared');
  }, [loadAll, showToast]);

  // ─── Computed ───
  const allItems = [...items, ...sold];
  const totalSpent = allItems.reduce((s, i) => s + parseFloat(i.total_cost || 0), 0);
  const totalRev = sold.reduce((s, i) => s + parseFloat(i.sold_price || 0), 0);
  const totalProfit = sold.reduce((s, i) => s + parseFloat(i.profit || 0), 0);
  const filt = (arr) => arr.filter(i => { if (!search) return true; const t = search.toLowerCase(); return [i.title, i.description, i.auction_house, i.lot_number, i.sold_buyer].some(f => f?.toLowerCase?.().includes(t)); });
  const activeTab = subTab || tab;

  // ═══════════════════════════════════════
  // AUTH SCREEN
  // ═══════════════════════════════════════
  if (authState === 'loading') return (
    <div style={S.splash}><svg width="48" height="48" viewBox="0 0 28 28" fill="none"><rect width="28" height="28" rx="6" fill="#F59E0B"/><path d="M7 19L14 7l7 12H7z" fill="#0F172A"/><circle cx="14" cy="15" r="2" fill="#F59E0B"/></svg><p style={{color:'var(--accent)',fontFamily:'var(--font-display)',fontSize:20,fontWeight:700,marginTop:12}}>Auction Vault</p><div style={S.spinner}/></div>
  );

  if (authState === 'login') return (
    <div style={S.splash}>
      <svg width="40" height="40" viewBox="0 0 28 28" fill="none"><rect width="28" height="28" rx="6" fill="#F59E0B"/><path d="M7 19L14 7l7 12H7z" fill="#0F172A"/><circle cx="14" cy="15" r="2" fill="#F59E0B"/></svg>
      <h1 style={{fontFamily:'var(--font-display)',color:'var(--accent)',fontSize:22,margin:'12px 0 4px'}}>Auction Vault</h1>
      <p style={{color:'var(--text-muted)',fontSize:12,margin:'0 0 20px'}}>Sign in to sync across all your devices</p>
      <div style={{width:'100%',maxWidth:340,padding:'0 20px'}}>
        {authError && <p style={{color:'var(--red)',fontSize:12,marginBottom:8,textAlign:'center'}}>{authError}</p>}
        <input style={S.input} type="email" placeholder="Email" value={authForm.email} onChange={e => setAuthForm({...authForm, email: e.target.value})}/>
        <input style={{...S.input,marginTop:8}} type="password" placeholder="Password" value={authForm.password} onChange={e => setAuthForm({...authForm, password: e.target.value})} onKeyDown={e => e.key === 'Enter' && handleAuth()}/>
        <button style={{...S.primaryBtn,width:'100%',marginTop:12}} onClick={handleAuth} disabled={authLoading}>
          {authLoading ? '...' : authForm.mode === 'login' ? 'Sign In' : 'Create Account'}
        </button>
        <button style={{background:'none',border:'none',color:'var(--accent)',fontSize:12,cursor:'pointer',marginTop:10,fontFamily:'var(--font-sans)',width:'100%',textAlign:'center'}} onClick={() => setAuthForm({...authForm, mode: authForm.mode === 'login' ? 'signup' : 'login'})}>
          {authForm.mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );

  // ═══════════════════════════════════════
  // MAIN APP
  // ═══════════════════════════════════════
  return (
    <div style={S.app}>
      <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:opsz@9..40;wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>

      <header style={S.header} className="safe-top">
        <div style={S.headerRow}>
          <svg width="20" height="20" viewBox="0 0 28 28" fill="none"><rect width="28" height="28" rx="6" fill="#F59E0B"/><path d="M7 19L14 7l7 12H7z" fill="#0F172A"/><circle cx="14" cy="15" r="2" fill="#F59E0B"/></svg>
          <span style={S.headerTitle}>Auction Vault</span>
        </div>
        <div style={S.headerStats}>
          <span style={S.statChip}><b>{items.length}</b> stock</span>
          <span style={{...S.statChip,color:totalProfit>=0?'var(--green)':'var(--red)'}}>{fmt(totalProfit)}</span>
        </div>
      </header>

      {toast && <div className="fade-in" style={{...S.toast,background:toast.type==='success'?'#065F46':toast.type==='error'?'#991B1B':'#1E3A5F'}}>{toast.type==='info'&&<div style={S.miniSpin}/>}{toast.type==='success'&&'✅ '}{toast.type==='error'&&'❌ '}{toast.msg}</div>}

      <main style={S.content} className="safe-bottom">
        {/* UPLOAD */}
        {activeTab==='upload'&&<div className="fade-in">
          <div style={S.uploadArea}>
            <svg width="44" height="44" viewBox="0 0 64 64" fill="none"><rect x="8" y="16" width="48" height="40" rx="4" stroke="#F59E0B" strokeWidth="2.5" fill="none"/><path d="M24 36l8-10 8 10" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/><line x1="32" y1="28" x2="32" y2="48" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round"/></svg>
            <h2 style={S.uploadTitle}>Upload Invoice</h2>
            <p style={S.muted}>PDF or photo — AI extracts everything</p>
            <label style={S.primaryBtn} role="button"><input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={handleUpload} style={{display:'none'}}/>📄 Choose File</label>
            <p style={{fontSize:10,color:'var(--text-hint)',marginTop:8}}>Files stored in Supabase cloud • Syncs across devices</p>
          </div>
          <div style={{display:'flex',gap:6,overflowX:'auto',paddingTop:16,paddingBottom:4}}>
            {['📄 Upload','🤖 AI Parse','📦 Stock','📸 Photos','💰 Sell','🧾 Receipt','📧 Send'].map((s,i)=><div key={i} style={S.stepDot}><span style={{fontSize:14}}>{s.split(' ')[0]}</span><span style={{fontSize:8,color:'var(--text-muted)'}}>{s.split(' ').slice(1).join(' ')}</span></div>)}
          </div>
        </div>}

        {/* INVOICES */}
        {activeTab==='invoices'&&<div className="fade-in">
          <h2 style={S.pageTitle}>Invoices <span style={S.count}>{invoices.length}</span></h2>
          {invoices.length===0?<Empty/>:invoices.map((inv,i)=><div key={inv.id} className="fade-in" style={{...S.listCard,animationDelay:`${i*40}ms`}}>
            <div style={S.listCardTop}>
              <div style={{flex:1}}><p style={S.listTitle}>{inv.auction_house}</p><p style={S.listSub}>{fmtDate(inv.date)} • {inv.invoice_number} • {inv.item_count} items</p></div>
              <div style={{textAlign:'right'}}><p style={{...S.mono,fontSize:15,fontWeight:700,color:'var(--accent)'}}>{fmt(inv.grand_total)}</p><Chip text={inv.payment_status||'?'} ok={inv.payment_status==='Paid'}/></div>
            </div>
            <div style={S.listCardActions}>
              <button style={S.tinyBtn} onClick={()=>handleViewInvoice(inv)}>👁 Original</button>
              <button style={S.tinyBtn} onClick={()=>{setTab('inventory');setSearch(inv.auction_house);}}>📦 Items</button>
              <button style={{...S.tinyBtn,color:'var(--red)'}} onClick={()=>handleDeleteInvoice(inv.id)}>🗑</button>
            </div>
          </div>)}
        </div>}

        {/* INVENTORY */}
        {activeTab==='inventory'&&<div className="fade-in">
          <h2 style={S.pageTitle}>Inventory <span style={S.count}>{items.length}</span></h2>
          <input style={S.searchBar} placeholder="🔍 Search items..." value={search} onChange={e=>setSearch(e.target.value)}/>
          {filt(items).length===0?<Empty text={search?'No matches':'Upload an invoice'}/>:filt(items).map((item,i)=>
            <div key={item.id} className="fade-in" style={{...S.itemCard,animationDelay:`${i*30}ms`}}>
              <div style={S.itemTop}>
                <div style={{...S.itemThumb,...S.noThumb}} onClick={()=>{setImgModal(item.id);loadPhotos(item.id);}}>📷</div>
                <div style={{flex:1,minWidth:0}}>
                  <p style={S.itemTitle}>{item.title}</p>
                  <p style={S.itemSub}>{item.auction_house} • Lot #{item.lot_number}</p>
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                  <p style={{...S.mono,fontSize:10,color:'var(--text-muted)'}}>Hammer {fmt(item.hammer_price)}</p>
                  <p style={{...S.mono,fontSize:14,fontWeight:700,color:'var(--accent)'}}>{fmt(item.total_cost)}</p>
                </div>
              </div>
              <div style={S.itemActions}>
                <button style={S.actionBtn} onClick={()=>{setImgModal(item.id);loadPhotos(item.id);}}>📷 Photo</button>
                <button style={{...S.actionBtn,...S.sellBtn}} onClick={()=>setSellModal(item.id)}>💰 Sell</button>
                <button style={S.actionBtn} onClick={()=>viewLifecycle(item,false)}>🔄</button>
              </div>
            </div>
          )}
        </div>}

        {/* SOLD */}
        {activeTab==='sold'&&<div className="fade-in">
          <h2 style={S.pageTitle}>Sold <span style={{...S.count,background:'rgba(16,185,129,.15)',color:'var(--green)'}}>{sold.length}</span></h2>
          {sold.length===0?<Empty text="No sales yet"/>:sold.map((si,i)=><div key={si.id} className="fade-in" style={{...S.listCard,animationDelay:`${i*30}ms`}}>
            <div style={S.listCardTop}>
              <div style={{flex:1,minWidth:0}}><p style={S.listTitle}>{si.title}</p><p style={S.listSub}>{si.sold_buyer||'Walk-in'} • {si.sold_platform||'Direct'} • {fmtTs(si.sold_at)}</p></div>
              <div style={{textAlign:'right',flexShrink:0}}>
                <p style={{...S.mono,fontSize:14,fontWeight:700}}>{fmt(si.sold_price)}</p>
                <p style={{...S.mono,fontSize:12,fontWeight:700,color:parseFloat(si.profit)>=0?'var(--green)':'var(--red)'}}>{parseFloat(si.profit)>=0?'+':''}{fmt(si.profit)}</p>
              </div>
            </div>
            <div style={S.listCardActions}>
              <button style={S.tinyBtn} onClick={()=>handleGenReceipt(si)}>🧾 Receipt</button>
              <button style={S.tinyBtn} onClick={()=>setShareModal(si.id)}>📤 Share</button>
              <button style={S.tinyBtn} onClick={()=>viewLifecycle(si,true)}>🔄</button>
            </div>
          </div>)}
          {sold.length>0&&<div style={S.summaryBar}>
            <div><span style={{fontSize:9,color:'var(--text-muted)'}}>COST</span><p style={S.mono}>{fmt(sold.reduce((s,i)=>s+parseFloat(i.total_cost||0),0))}</p></div>
            <div><span style={{fontSize:9,color:'var(--text-muted)'}}>REVENUE</span><p style={{...S.mono,fontWeight:700}}>{fmt(totalRev)}</p></div>
            <div><span style={{fontSize:9,color:'var(--text-muted)'}}>PROFIT</span><p style={{...S.mono,fontWeight:700,color:totalProfit>=0?'var(--green)':'var(--red)'}}>{totalProfit>=0?'+':''}{fmt(totalProfit)}</p></div>
          </div>}
        </div>}

        {/* LIFECYCLE */}
        {activeTab==='lifecycle'&&<div className="fade-in">
          <h2 style={S.pageTitle}>Lifecycle</h2>
          {!lcItem?<div>
            <p style={{color:'var(--text-muted)',fontSize:12,marginBottom:8}}>Select an item:</p>
            {allItems.map(i=><button key={i.id} style={S.lcRow} onClick={()=>viewLifecycle(i,!!i.sold_price)}>
              <Chip text={i.sold_price?'Sold':'Stock'} ok={!!i.sold_price}/>
              <span style={{flex:1,textAlign:'left',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:13,fontWeight:500}}>{i.title}</span>
            </button>)}
          </div>:<div>
            <button onClick={()=>{setLcItem(null);setLcEvents([]);}} style={S.backBtn}>← Back</button>
            <h3 style={{fontSize:16,fontFamily:'var(--font-display)',margin:'0 0 4px'}}>{lcItem.title}</h3>
            <p style={{fontSize:11,color:'var(--text-muted)',margin:'0 0 12px'}}>{lcItem.auction_house} • Lot #{lcItem.lot_number}</p>
            <div style={S.numRow}>
              <NB l="Cost" v={fmt(lcItem.total_cost)} hi/><NB l="Hammer" v={fmt(lcItem.hammer_price)}/>
              {lcItem.sold_price&&<><NB l="Sold" v={fmt(lcItem.sold_price)} hi/><NB l="Profit" v={`${parseFloat(lcItem.profit)>=0?'+':''}${fmt(lcItem.profit)}`} c={parseFloat(lcItem.profit)>=0?'var(--green)':'var(--red)'}/></>}
            </div>
            <h4 style={{color:'var(--accent)',margin:'14px 0 8px',fontFamily:'var(--font-display)',fontSize:13}}>Timeline</h4>
            <div style={S.timeline}>{lcEvents.map((ev,i)=><div key={ev.id} style={S.tlEntry}>
              <div style={S.tlDot}>{i===lcEvents.length-1?'●':'○'}</div>
              <div><p style={{fontSize:13,fontWeight:500}}>{ev.event}</p><p style={{fontSize:10,color:'var(--text-muted)'}}>{fmtTs(ev.created_at)}</p><p style={{fontSize:11,color:'var(--text-secondary)'}}>{ev.detail}</p></div>
            </div>)}</div>
          </div>}
        </div>}

        {/* ANALYTICS */}
        {activeTab==='analytics'&&<div className="fade-in">
          <h2 style={S.pageTitle}>Analytics</h2>
          <div style={S.metricGrid}>
            <MC t="Invested" v={fmt(totalSpent)} i="💰"/><MC t="In Stock" v={fmt(items.reduce((s,i)=>s+parseFloat(i.total_cost||0),0))} i="📦"/>
            <MC t="Revenue" v={fmt(totalRev)} i="📈"/><MC t="Profit" v={`${totalProfit>=0?'+':''}${fmt(totalProfit)}`} i={totalProfit>=0?'🟢':'🔴'} c={totalProfit>=0?'var(--green)':'var(--red)'}/>
          </div>
          <h4 style={{color:'var(--text-primary)',margin:'16px 0 8px',fontFamily:'var(--font-display)',fontSize:13}}>By auction house</h4>
          {Object.entries(allItems.reduce((a,i)=>{const k=i.auction_house||'?';if(!a[k])a[k]={n:0,t:0};a[k].n++;a[k].t+=parseFloat(i.total_cost||0);return a;},{})).sort((a,b)=>b[1].t-a[1].t).map(([h,d])=>
            <div key={h} style={S.anaRow}><span style={{flex:1,fontSize:13,fontWeight:500}}>{h}</span><span style={{...S.mono,fontSize:11,color:'var(--text-muted)'}}>{d.n}</span><span style={{...S.mono,fontSize:13,fontWeight:600,marginLeft:12}}>{fmt(d.t)}</span></div>
          )}
        </div>}

        {/* SETTINGS */}
        {activeTab==='settings'&&<div className="fade-in">
          <h2 style={S.pageTitle}>Settings</h2>
          <div style={S.card}><p style={{fontSize:11,color:'var(--text-muted)',margin:'0 0 4px'}}>Signed in as</p><p style={{fontSize:13,fontWeight:600}}>{user?.email}</p><button style={{...S.tinyBtn,marginTop:8,color:'var(--red)'}} onClick={()=>db.signOut()}>Sign Out</button></div>
          <div style={{...S.card,marginTop:10}}>
            <h3 style={{fontSize:14,color:'var(--accent)',fontFamily:'var(--font-display)',margin:'0 0 10px'}}>Business Info (receipts)</h3>
            <Lbl t="Name"/><input style={S.input} value={biz.business_name||''} onChange={e=>setBiz({...biz,business_name:e.target.value})}/>
            <Lbl t="Address"/><input style={S.input} value={biz.address||''} onChange={e=>setBiz({...biz,address:e.target.value})}/>
            <Lbl t="Phone"/><input style={S.input} value={biz.phone||''} onChange={e=>setBiz({...biz,phone:e.target.value})}/>
            <Lbl t="Email"/><input style={S.input} value={biz.email||''} onChange={e=>setBiz({...biz,email:e.target.value})}/>
            <Lbl t="HST #"/><input style={S.input} value={biz.hst||''} onChange={e=>setBiz({...biz,hst:e.target.value})}/>
            <button style={{...S.primaryBtn,width:'100%',marginTop:12}} onClick={saveBiz}>Save ✓</button>
          </div>
          <div style={{...S.card,marginTop:10}}>
            <h3 style={{fontSize:14,color:'var(--accent)',fontFamily:'var(--font-display)',margin:'0 0 6px'}}>Storage</h3>
            <p style={{fontSize:11,color:'var(--text-muted)',lineHeight:1.5}}>All data stored in <b>Supabase cloud</b> — syncs across devices. Photos and original invoices in Supabase Storage. Auth via Supabase Auth.</p>
          </div>
          <button style={S.dangerBtn} onClick={handleReset}>🗑 Reset All Data</button>
        </div>}

        {/* MORE MENU */}
        {activeTab==='more'&&!subTab&&<div className="fade-in">
          <h2 style={S.pageTitle}>More</h2>
          {[{id:'lifecycle',icon:'🔄',t:'Lifecycle',d:'Item journey tracker'},{id:'analytics',icon:'📊',t:'Analytics',d:'Revenue & profit'},{id:'settings',icon:'⚙',t:'Settings',d:'Account & business info'}].map(m=>
            <button key={m.id} style={S.menuRow} onClick={()=>setSubTab(m.id)}><span style={{fontSize:20}}>{m.icon}</span><div style={{flex:1,textAlign:'left'}}><p style={{fontSize:14,fontWeight:500,margin:0}}>{m.t}</p><p style={{fontSize:11,color:'var(--text-muted)',margin:0}}>{m.d}</p></div><span style={{color:'var(--text-muted)'}}>›</span></button>
          )}
        </div>}
      </main>

      {/* BOTTOM NAV */}
      <nav style={S.bottomNav}>
        {TABS.map(t=><button key={t.id} onClick={()=>{setTab(t.id);setSubTab(null);setLcItem(null);setSearch('');}} style={{...S.navItem,...(tab===t.id?S.navActive:{})}}>
          <span style={{fontSize:18}}>{t.icon}</span><span style={{fontSize:9,fontWeight:tab===t.id?700:400}}>{t.label}</span>
          {t.id==='inventory'&&items.length>0&&<span style={S.navBadge}>{items.length}</span>}
          {t.id==='sold'&&sold.length>0&&<span style={{...S.navBadge,background:'var(--green)'}}>{sold.length}</span>}
        </button>)}
      </nav>

      {/* ═══ MODALS ═══ */}
      {sellModal&&<Modal close={()=>setSellModal(null)}>
        <h3 style={S.mTitle}>💰 Record Sale</h3>
        <p style={{fontSize:14,fontWeight:600,margin:'0 0 2px'}}>{items.find(i=>i.id===sellModal)?.title}</p>
        <p style={{fontSize:11,color:'var(--text-muted)',margin:'0 0 12px'}}>Cost: {fmt(items.find(i=>i.id===sellModal)?.total_cost)}</p>
        <Lbl t="Amount *"/><input style={S.input} type="number" step="0.01" placeholder="0.00" value={sf.amount} onChange={e=>setSf({...sf,amount:e.target.value})} autoFocus/>
        <Lbl t="Platform"/><input style={S.input} placeholder="Facebook, Kijiji..." value={sf.platform} onChange={e=>setSf({...sf,platform:e.target.value})}/>
        <Lbl t="Buyer"/><input style={S.input} placeholder="Name" value={sf.buyer} onChange={e=>setSf({...sf,buyer:e.target.value})}/>
        <Lbl t="Email"/><input style={S.input} type="email" placeholder="email" value={sf.buyerEmail} onChange={e=>setSf({...sf,buyerEmail:e.target.value})}/>
        <Lbl t="Phone"/><input style={S.input} type="tel" placeholder="+1..." value={sf.buyerPhone} onChange={e=>setSf({...sf,buyerPhone:e.target.value})}/>
        {sf.amount&&<div style={S.profitPrev}><span>Profit:</span><strong style={{color:(parseFloat(sf.amount)-parseFloat(items.find(i=>i.id===sellModal)?.total_cost||0))>=0?'var(--green)':'var(--red)'}}>{(()=>{const p=parseFloat(sf.amount)-parseFloat(items.find(i=>i.id===sellModal)?.total_cost||0);return`${p>=0?'+':''}${fmt(p)}`;})()}</strong></div>}
        <div style={S.mBtns}><button style={S.cancelBtn} onClick={()=>setSellModal(null)}>Cancel</button><button style={S.confirmBtn} onClick={handleSell} disabled={!sf.amount}>Confirm ✓</button></div>
      </Modal>}

      {imgModal&&<Modal close={()=>setImgModal(null)}>
        <h3 style={S.mTitle}>📷 Photos</h3>
        <label style={{...S.primaryBtn,display:'block',textAlign:'center'}} role="button"><input type="file" accept="image/*" multiple onChange={e=>handlePhotoUpload(imgModal,e)} style={{display:'none'}}/>Upload Photos</label>
        {(itemPhotos[imgModal]||[]).length>0&&<div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:12}}>{itemPhotos[imgModal].map((p,i)=><img key={p.id||i} src={p.url} alt="" style={{width:64,height:64,objectFit:'cover',borderRadius:8,border:'2px solid var(--border)'}}/>)}</div>}
        <button style={{...S.cancelBtn,width:'100%',marginTop:12}} onClick={()=>setImgModal(null)}>Done</button>
      </Modal>}

      {viewInvModal&&<Modal close={()=>{setViewInvModal(null);setViewInvUrl(null);}}>
        <h3 style={S.mTitle}>📄 Original Invoice</h3>
        <p style={{fontSize:11,color:'var(--text-muted)',margin:'0 0 10px'}}>{viewInvModal.file_name}</p>
        {!viewInvUrl?<div style={{textAlign:'center',padding:20}}><div style={S.spinner}/></div>:
          viewInvModal.file_type?.includes('pdf')?<iframe src={viewInvUrl} style={{width:'100%',height:'60vh',borderRadius:8,border:'1px solid var(--border)'}}/>:
          <img src={viewInvUrl} alt="" style={{width:'100%',borderRadius:8}}/>
        }
      </Modal>}

      {receiptModal&&<Modal close={()=>{setReceiptModal(null);setReceiptHtml('');}}>
        <h3 style={S.mTitle}>🧾 Receipt</h3>
        {receiptLoading?<div style={{textAlign:'center',padding:28}}><div style={S.spinner}/><p style={{color:'var(--text-muted)',marginTop:8,fontSize:12}}>Generating...</p></div>:
        <div><div style={{background:'#fff',borderRadius:8,padding:4,maxHeight:'45vh',overflow:'auto',marginBottom:10}} dangerouslySetInnerHTML={{__html:receiptHtml}}/>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
            <button style={S.primaryBtn} onClick={()=>printHTML(receiptHtml)}>🖨 Print PDF</button>
            <button style={S.accentBtn} onClick={()=>{const si=sold.find(i=>i.id===receiptModal);if(si?.sold_buyer_email)setEmailTo(si.sold_buyer_email);setEmailModal(true);setShareModal(receiptModal);}}>📧 Email</button>
            <button style={S.ghostBtn} onClick={()=>{const si=sold.find(i=>i.id===receiptModal);if(si){const b={name:biz.business_name,phone:biz.phone};openWhatsApp(si.sold_buyer_phone,buildReceiptText(si,b));}}}>📱 WhatsApp</button>
            <button style={S.ghostBtn} onClick={()=>{const si=sold.find(i=>i.id===receiptModal);if(si){const b={name:biz.business_name,address:biz.address,phone:biz.phone};navigator.clipboard?.writeText(buildReceiptText(si,b));showToast('success','Copied!');}}}>📋 Copy</button>
          </div>
        </div>}
      </Modal>}

      {shareModal&&!receiptModal&&!emailModal&&<Modal close={()=>setShareModal(null)}>
        {(()=>{const si=sold.find(i=>i.id===shareModal);if(!si)return null;const b={name:biz.business_name,address:biz.address,phone:biz.phone};return<div>
          <h3 style={S.mTitle}>📤 Share</h3>
          <p style={{fontSize:14,fontWeight:600,margin:'0 0 12px'}}>{si.title} — {fmt(si.sold_price)}</p>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            <button style={S.shareRow} onClick={()=>handleGenReceipt(si)}>🧾 Generate Receipt</button>
            <button style={S.shareRow} onClick={()=>{if(si.sold_buyer_email)setEmailTo(si.sold_buyer_email);setEmailModal(true);}}>📧 Email</button>
            <button style={S.shareRow} onClick={()=>openWhatsApp(si.sold_buyer_phone,buildReceiptText(si,b))}>📱 WhatsApp</button>
            <button style={S.shareRow} onClick={()=>openSMS(si.sold_buyer_phone,buildReceiptText(si,b))}>💬 SMS</button>
            <button style={S.shareRow} onClick={()=>{navigator.clipboard?.writeText(buildReceiptText(si,b));showToast('success','Copied!');}}>📋 Copy</button>
          </div>
        </div>;})()}
      </Modal>}

      {emailModal&&<Modal close={()=>{setEmailModal(null);setEmailTo('');}}>
        <h3 style={S.mTitle}>📧 Email</h3>
        <Lbl t="Recipient *"/><input style={S.input} type="email" placeholder="email@..." value={emailTo} onChange={e=>setEmailTo(e.target.value)} autoFocus/>
        <div style={S.mBtns}><button style={S.cancelBtn} onClick={()=>{setEmailModal(null);setEmailTo('');}}>Cancel</button><button style={S.confirmBtn} onClick={handleEmail} disabled={!emailTo}>Send 📧</button></div>
      </Modal>}
    </div>
  );
}

// ─── Components ───
function Modal({close,children}){return<div style={S.overlay} onClick={close}><div className="slide-up" style={S.modal} onClick={e=>e.stopPropagation()}><div style={S.modalHandle}/>{children}</div></div>}
function Chip({text,ok}){return<span style={{display:'inline-block',padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:600,background:ok?'rgba(16,185,129,.15)':'rgba(239,68,68,.15)',color:ok?'var(--green)':'var(--red)'}}>{text}</span>}
function Empty({text='No data yet'}){return<div style={{textAlign:'center',padding:36,color:'var(--text-muted)'}}><p style={{fontSize:28,marginBottom:4}}>📭</p><p style={{fontSize:13}}>{text}</p></div>}
function Lbl({t}){return<label style={{display:'block',color:'var(--text-muted)',fontSize:9,textTransform:'uppercase',letterSpacing:1,margin:'8px 0 2px'}}>{t}</label>}
function NB({l,v,hi,c}){return<div style={{background:'var(--bg-surface)',borderRadius:10,padding:'7px 12px',flex:'1 1 70px',border:hi?'1px solid rgba(245,158,11,.2)':'1px solid var(--border)'}}><span style={{fontSize:8,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:1,display:'block'}}>{l}</span><span style={{fontSize:13,fontWeight:700,fontFamily:'var(--font-mono)',color:c||(hi?'var(--accent)':'var(--text-primary)')}}>{v}</span></div>}
function MC({t,v,i,c}){return<div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3,padding:14,background:'var(--bg-card)',borderRadius:14,border:'1px solid var(--border)',textAlign:'center'}}><span style={{fontSize:18}}>{i}</span><span style={{color:'var(--text-muted)',fontSize:9,textTransform:'uppercase',letterSpacing:1}}>{t}</span><span style={{color:c||'var(--text-primary)',fontSize:16,fontWeight:700,fontFamily:'var(--font-mono)'}}>{v}</span></div>}

// ─── Styles ───
const S={
  app:{display:'flex',flexDirection:'column',height:'100%',background:'var(--bg-app)'},
  splash:{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100vh',background:'var(--bg-app)'},
  spinner:{width:28,height:28,border:'3px solid var(--border)',borderTopColor:'var(--accent)',borderRadius:'50%',animation:'spin .8s linear infinite'},
  miniSpin:{width:14,height:14,border:'2px solid rgba(255,255,255,.3)',borderTopColor:'#fff',borderRadius:'50%',animation:'spin .6s linear infinite',flexShrink:0},
  header:{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 16px',background:'var(--bg-card)',borderBottom:'1px solid var(--border)',flexShrink:0,zIndex:10},
  headerRow:{display:'flex',alignItems:'center',gap:8},
  headerTitle:{fontSize:16,fontFamily:'var(--font-display)',color:'var(--accent)',fontWeight:700},
  headerStats:{display:'flex',gap:8},
  statChip:{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-secondary)'},
  toast:{position:'fixed',top:56,left:12,right:12,padding:'10px 16px',borderRadius:12,color:'#fff',fontSize:12,display:'flex',alignItems:'center',gap:8,zIndex:100,fontWeight:500},
  content:{flex:1,overflow:'auto',padding:'12px 16px',paddingBottom:'calc(68px + env(safe-area-inset-bottom, 0px))'},
  bottomNav:{display:'flex',justifyContent:'space-around',background:'var(--bg-card)',borderTop:'1px solid var(--border)',position:'fixed',bottom:0,left:0,right:0,zIndex:50,paddingBottom:'env(safe-area-inset-bottom, 0px)'},
  navItem:{display:'flex',flexDirection:'column',alignItems:'center',gap:2,padding:'8px 0',minWidth:56,background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',fontFamily:'var(--font-sans)',position:'relative'},
  navActive:{color:'var(--accent)'},
  navBadge:{position:'absolute',top:4,right:8,background:'var(--blue)',color:'#fff',fontSize:8,padding:'1px 4px',borderRadius:10,fontWeight:700,minWidth:14,textAlign:'center'},
  pageTitle:{fontSize:20,fontFamily:'var(--font-display)',color:'var(--accent)',fontWeight:700,margin:'0 0 12px',display:'flex',alignItems:'center',gap:8},
  count:{background:'rgba(245,158,11,.15)',color:'var(--accent)',padding:'2px 10px',borderRadius:8,fontSize:13,fontWeight:700,fontFamily:'var(--font-mono)'},
  uploadArea:{display:'flex',flexDirection:'column',alignItems:'center',padding:'28px 20px',background:'var(--bg-card)',borderRadius:16,border:'2px dashed var(--border-hover)',textAlign:'center'},
  uploadTitle:{fontFamily:'var(--font-display)',fontSize:18,color:'var(--accent)',margin:'8px 0 4px'},
  muted:{color:'var(--text-muted)',fontSize:12,margin:'0 0 14px'},
  primaryBtn:{display:'inline-block',padding:'12px 28px',background:'var(--accent)',color:'#0F172A',borderRadius:12,fontWeight:700,fontSize:14,cursor:'pointer',fontFamily:'var(--font-sans)',border:'none',textAlign:'center'},
  accentBtn:{padding:'12px',background:'rgba(245,158,11,.15)',border:'1px solid rgba(245,158,11,.3)',borderRadius:12,color:'var(--accent)',cursor:'pointer',fontSize:13,fontWeight:600,fontFamily:'var(--font-sans)',textAlign:'center'},
  ghostBtn:{padding:'12px',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,color:'var(--text-secondary)',cursor:'pointer',fontSize:13,fontFamily:'var(--font-sans)',textAlign:'center'},
  dangerBtn:{width:'100%',padding:'14px',background:'rgba(239,68,68,.1)',border:'1px solid rgba(239,68,68,.3)',borderRadius:12,color:'var(--red)',cursor:'pointer',fontSize:14,fontFamily:'var(--font-sans)',marginTop:16},
  stepDot:{display:'flex',flexDirection:'column',alignItems:'center',gap:2,padding:'8px 6px',background:'var(--bg-card)',borderRadius:12,border:'1px solid var(--border)',minWidth:52,flexShrink:0},
  searchBar:{width:'100%',padding:'10px 14px',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,color:'var(--text-primary)',fontSize:14,outline:'none',fontFamily:'var(--font-sans)',marginBottom:10,boxSizing:'border-box'},
  listCard:{background:'var(--bg-card)',borderRadius:14,border:'1px solid var(--border)',marginBottom:8,overflow:'hidden'},
  listCardTop:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',padding:'12px 14px',gap:8},
  listTitle:{fontSize:14,fontWeight:600,margin:'0 0 2px'},
  listSub:{fontSize:11,color:'var(--text-muted)',margin:0},
  listCardActions:{display:'flex',gap:6,padding:'8px 14px',borderTop:'1px solid var(--border)'},
  tinyBtn:{padding:'6px 10px',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:8,color:'var(--text-secondary)',cursor:'pointer',fontSize:11,fontFamily:'var(--font-sans)'},
  itemCard:{background:'var(--bg-card)',borderRadius:14,border:'1px solid var(--border)',marginBottom:8,overflow:'hidden'},
  itemTop:{display:'flex',gap:10,padding:'12px 14px',alignItems:'flex-start'},
  itemThumb:{width:48,height:48,borderRadius:10,overflow:'hidden',flexShrink:0},
  noThumb:{background:'var(--bg-surface)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,cursor:'pointer'},
  itemTitle:{fontSize:14,fontWeight:600,margin:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'},
  itemSub:{fontSize:11,color:'var(--text-muted)',margin:0},
  itemActions:{display:'flex',gap:5,padding:'8px 14px',borderTop:'1px solid var(--border)'},
  actionBtn:{padding:'7px 12px',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:10,color:'var(--text-secondary)',cursor:'pointer',fontSize:12,fontFamily:'var(--font-sans)'},
  sellBtn:{flex:1,background:'rgba(245,158,11,.1)',border:'1px solid rgba(245,158,11,.3)',color:'var(--accent)',fontWeight:600},
  summaryBar:{display:'flex',justifyContent:'space-around',padding:'12px',background:'var(--bg-card)',borderRadius:14,border:'1px solid var(--border)',marginTop:8},
  mono:{fontFamily:'var(--font-mono)',fontSize:13,margin:0},
  numRow:{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12},
  timeline:{borderLeft:'2px solid var(--border)',marginLeft:6,paddingLeft:14},
  tlEntry:{display:'flex',gap:8,padding:'7px 0',position:'relative'},
  tlDot:{position:'absolute',left:-21,top:10,color:'var(--accent)',fontSize:8},
  metricGrid:{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:10},
  anaRow:{display:'flex',alignItems:'center',padding:'10px 14px',background:'var(--bg-card)',borderRadius:10,border:'1px solid var(--border)',marginBottom:6},
  card:{background:'var(--bg-card)',borderRadius:14,border:'1px solid var(--border)',padding:14},
  menuRow:{display:'flex',alignItems:'center',gap:12,padding:'14px 16px',background:'var(--bg-card)',borderRadius:14,border:'1px solid var(--border)',cursor:'pointer',width:'100%',fontFamily:'var(--font-sans)',marginBottom:6,color:'var(--text-primary)'},
  lcRow:{display:'flex',alignItems:'center',gap:8,padding:'10px 12px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:10,cursor:'pointer',width:'100%',fontFamily:'var(--font-sans)',marginBottom:4,color:'var(--text-primary)'},
  backBtn:{background:'none',border:'1px solid var(--border)',borderRadius:8,padding:'6px 12px',color:'var(--text-secondary)',cursor:'pointer',marginBottom:10,fontSize:12,fontFamily:'var(--font-sans)'},
  shareRow:{padding:'12px 14px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:12,color:'var(--text-primary)',cursor:'pointer',fontSize:13,fontFamily:'var(--font-sans)',textAlign:'left',width:'100%'},
  overlay:{position:'fixed',inset:0,background:'rgba(0,0,0,.6)',display:'flex',alignItems:'flex-end',justifyContent:'center',zIndex:200},
  modal:{background:'var(--bg-surface)',borderRadius:'20px 20px 0 0',padding:'8px 20px 24px',width:'100%',maxWidth:500,maxHeight:'90vh',overflow:'auto'},
  modalHandle:{width:36,height:4,background:'var(--border-hover)',borderRadius:4,margin:'0 auto 12px'},
  mTitle:{fontSize:16,fontFamily:'var(--font-display)',color:'var(--accent)',margin:'0 0 8px'},
  input:{width:'100%',padding:'10px 12px',background:'var(--bg-input)',border:'1px solid var(--border)',borderRadius:10,color:'var(--text-primary)',fontSize:14,outline:'none',fontFamily:'var(--font-mono)',boxSizing:'border-box'},
  profitPrev:{display:'flex',justifyContent:'space-between',padding:'8px 12px',background:'var(--bg-input)',borderRadius:10,marginTop:8,fontSize:13,color:'var(--text-muted)'},
  mBtns:{display:'flex',gap:8,marginTop:12},
  cancelBtn:{flex:1,padding:'12px',background:'none',border:'1px solid var(--border)',borderRadius:12,color:'var(--text-secondary)',cursor:'pointer',fontSize:13,fontFamily:'var(--font-sans)'},
  confirmBtn:{flex:1,padding:'12px',background:'var(--accent)',border:'none',borderRadius:12,color:'#0F172A',cursor:'pointer',fontSize:13,fontWeight:700,fontFamily:'var(--font-sans)'},
};
