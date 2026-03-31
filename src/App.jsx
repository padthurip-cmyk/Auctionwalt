import { useState, useEffect, useCallback, useRef } from 'react';
import * as db from './utils/db';
import { parseInvoiceAI, generateReceiptAI, sendGmail } from './utils/api';
import { uid, fmt, fmtDate, fmtTs, readFileAsBase64, readFileAsDataURL, openWhatsApp, openSMS, printHTML, buildReceiptText } from './utils/helpers';

const DEFAULT_BIZ = { name: '', address: '', phone: '', email: '', hst: '' };
const TABS = [
  { id: 'upload', icon: '⬆', label: 'Upload' },
  { id: 'invoices', icon: '📋', label: 'Invoices' },
  { id: 'inventory', icon: '📦', label: 'Stock' },
  { id: 'sold', icon: '✅', label: 'Sold' },
  { id: 'receipts', icon: '🧾', label: 'Receipts' },
  { id: 'more', icon: '⋯', label: 'More' },
];

export default function App() {
  const [tab, setTab] = useState('upload');
  const [subTab, setSubTab] = useState(null); // for More menu
  const [invoices, setInvoices] = useState([]);
  const [items, setItems] = useState([]);
  const [sold, setSold] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [biz, setBiz] = useState(DEFAULT_BIZ);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState('');

  // Modals
  const [sellModal, setSellModal] = useState(null);
  const [imgModal, setImgModal] = useState(null);
  const [receiptModal, setReceiptModal] = useState(null);
  const [receiptHtml, setReceiptHtml] = useState('');
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [shareModal, setShareModal] = useState(null);
  const [emailModal, setEmailModal] = useState(null);
  const [emailTo, setEmailTo] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [bizModal, setBizModal] = useState(false);
  const [viewInvoiceModal, setViewInvoiceModal] = useState(null);
  const [viewInvoiceData, setViewInvoiceData] = useState(null);
  const [lcItem, setLcItem] = useState(null);
  const [moreMenu, setMoreMenu] = useState(false);

  const [sf, setSf] = useState({ amount: '', platform: '', buyer: '', buyerEmail: '', buyerPhone: '' });
  const fileRef = useRef(null);

  // ─── Load ───
  useEffect(() => {
    (async () => {
      const [inv, itm, sld, cust] = await Promise.all([
        db.getAll('invoices'), db.getAll('items'), db.getAll('sold'), db.getAll('customers')
      ]);
      const bizData = await db.getSetting('businessInfo', DEFAULT_BIZ);
      setInvoices(inv || []); setItems(itm || []); setSold(sld || []); setCustomers(cust || []);
      setBiz(bizData);
      setLoading(false);
    })();
  }, []);

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // ─── Upload Invoice ───
  const handleUpload = useCallback(async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    showToast('info', `Reading "${file.name}"...`);
    try {
      const b64 = await readFileAsBase64(file);
      showToast('info', 'Claude AI is analyzing your invoice...');
      const result = await parseInvoiceAI(b64, file.type);
      const invId = uid();

      // Save original file to IndexedDB
      await db.saveFile(invId, b64, file.name, file.type);

      const newInv = { id: invId, ...result.invoice, fileName: file.name, fileType: file.type, uploadedAt: new Date().toISOString(), itemCount: result.items.length };
      await db.putOne('invoices', newInv);
      setInvoices(p => [...p, newInv]);

      const now = new Date().toISOString();
      const newItems = result.items.map(item => {
        const pr = result.invoice.buyer_premium_rate || 0;
        const tr = result.invoice.tax_rate || 0.13;
        return {
          id: uid(), invoiceId: invId, ...item,
          auction_house: result.invoice.auction_house, date: result.invoice.date,
          premium_rate: pr, tax_rate: tr,
          premium_amount: +(item.hammer_price * pr).toFixed(2),
          subtotal: +(item.hammer_price * (1 + pr)).toFixed(2),
          tax_amount: +(item.hammer_price * (1 + pr) * tr).toFixed(2),
          total_cost: +(item.hammer_price * (1 + pr) * (1 + tr)).toFixed(2),
          status: 'in_inventory', images: [],
          pickup_location: result.invoice.pickup_location || '',
          payment_method: result.invoice.payment_method,
          lifecycle: [
            { event: 'Invoice Uploaded', ts: now, detail: file.name },
            { event: 'AI Extraction', ts: now, detail: `${result.items.length} items from ${result.invoice.auction_house}` },
            { event: 'Added to Inventory', ts: now, detail: `Lot #${item.lot_number}` }
          ]
        };
      });
      await db.putMany('items', newItems);
      setItems(p => [...p, ...newItems]);
      showToast('success', `${result.items.length} items from "${result.invoice.auction_house}"`);
    } catch (err) {
      console.error(err);
      showToast('error', err.message || 'Failed to parse invoice');
    }
    if (fileRef.current) fileRef.current.value = '';
  }, [showToast]);

  // ─── View Original Invoice ───
  const handleViewInvoice = useCallback(async (inv) => {
    setViewInvoiceModal(inv);
    const file = await db.getFile(inv.id);
    setViewInvoiceData(file);
  }, []);

  // ─── Image Upload ───
  const handleImg = useCallback(async (itemId, e) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      const dataUrl = await readFileAsDataURL(file);
      setItems(p => {
        const updated = p.map(i => i.id !== itemId ? i : {
          ...i,
          images: [...(i.images || []), { data: dataUrl, name: file.name, at: new Date().toISOString() }],
          lifecycle: [...i.lifecycle, { event: 'Photo Added', ts: new Date().toISOString(), detail: file.name }]
        });
        const item = updated.find(i => i.id === itemId);
        if (item) db.putOne('items', item);
        return updated;
      });
    }
    setImgModal(null);
  }, []);

  // ─── Sell ───
  const handleSell = useCallback(async () => {
    if (!sellModal || !sf.amount) return;
    const amount = parseFloat(sf.amount); if (isNaN(amount)) return;
    const now = new Date().toISOString();
    const item = items.find(i => i.id === sellModal); if (!item) return;
    const rcpt = `RCP-${Date.now().toString(36).toUpperCase()}`;

    const soldItem = {
      ...item, status: 'sold', sold_price: amount, sold_platform: sf.platform,
      sold_buyer: sf.buyer, sold_buyer_email: sf.buyerEmail, sold_buyer_phone: sf.buyerPhone,
      sold_at: now, receipt_number: rcpt,
      profit: +(amount - item.total_cost).toFixed(2),
      profit_pct: item.total_cost > 0 ? +(((amount - item.total_cost) / item.total_cost) * 100).toFixed(1) : 0,
      lifecycle: [...item.lifecycle, { event: 'Sold', ts: now, detail: `${fmt(amount)}${sf.platform ? ` via ${sf.platform}` : ''}${sf.buyer ? ` to ${sf.buyer}` : ''} • ${rcpt}` }]
    };

    await db.putOne('sold', soldItem);
    await db.deleteOne('items', sellModal);
    setSold(p => [...p, soldItem]);
    setItems(p => p.filter(i => i.id !== sellModal));

    if (sf.buyer && !customers.find(c => c.name === sf.buyer)) {
      const cust = { id: uid(), name: sf.buyer, email: sf.buyerEmail, phone: sf.buyerPhone, first: now };
      await db.putOne('customers', cust);
      setCustomers(p => [...p, cust]);
    }

    setSellModal(null); setSf({ amount: '', platform: '', buyer: '', buyerEmail: '', buyerPhone: '' });
    showToast('success', `Sold! Receipt #${rcpt}`);
  }, [sellModal, sf, items, customers, showToast]);

  // ─── Receipt ───
  const handleGenReceipt = useCallback(async (si) => {
    setReceiptModal(si.id); setReceiptLoading(true); setReceiptHtml('');
    try {
      const html = await generateReceiptAI(si, biz, { name: si.sold_buyer || 'Walk-in Customer', email: si.sold_buyer_email || '', phone: si.sold_buyer_phone || '' });
      setReceiptHtml(html);
      const updated = { ...si, receiptHtml: html, lifecycle: [...si.lifecycle, { event: 'Receipt Generated', ts: new Date().toISOString(), detail: si.receipt_number }] };
      await db.putOne('sold', updated);
      setSold(p => p.map(i => i.id === si.id ? updated : i));
    } catch (err) { showToast('error', err.message); setReceiptModal(null); }
    setReceiptLoading(false);
  }, [biz, showToast]);

  // ─── Email ───
  const handleEmail = useCallback(async () => {
    if (!emailTo || !shareModal) return;
    setEmailSending(true);
    const si = sold.find(i => i.id === shareModal);
    try {
      await sendGmail(emailTo, `Receipt #${si?.receipt_number} from ${biz.name}`, si?.receiptHtml || receiptHtml);
      const updated = { ...si, lifecycle: [...si.lifecycle, { event: 'Emailed', ts: new Date().toISOString(), detail: emailTo }] };
      await db.putOne('sold', updated);
      setSold(p => p.map(i => i.id === shareModal ? updated : i));
      showToast('success', `Sent to ${emailTo}`);
      setEmailModal(null); setEmailTo(''); setShareModal(null);
    } catch (err) { showToast('error', err.message); }
    setEmailSending(false);
  }, [emailTo, shareModal, sold, biz, receiptHtml, showToast]);

  // ─── Delete Invoice ───
  const handleDeleteInvoice = useCallback(async (invId) => {
    if (!confirm('Delete this invoice and its items?')) return;
    const itemIds = items.filter(i => i.invoiceId === invId).map(i => i.id);
    await db.deleteOne('invoices', invId);
    if (itemIds.length) await db.deleteMany('items', itemIds);
    setInvoices(p => p.filter(i => i.id !== invId));
    setItems(p => p.filter(i => i.invoiceId !== invId));
    showToast('success', 'Invoice deleted');
  }, [items, showToast]);

  // ─── Save Biz ───
  const saveBiz = useCallback(async () => {
    await db.setSetting('businessInfo', biz);
    setBizModal(false);
    showToast('success', 'Business info saved');
  }, [biz, showToast]);

  // ─── Reset ───
  const handleReset = useCallback(async () => {
    if (!confirm('Delete ALL data? This cannot be undone.')) return;
    await db.clearAll();
    setInvoices([]); setItems([]); setSold([]); setCustomers([]);
    showToast('success', 'All data cleared');
  }, [showToast]);

  // ─── Computed ───
  const allItems = [...items, ...sold];
  const totalSpent = allItems.reduce((s, i) => s + (i.total_cost || 0), 0);
  const totalRev = sold.reduce((s, i) => s + (i.sold_price || 0), 0);
  const totalProfit = sold.reduce((s, i) => s + (i.profit || 0), 0);
  const filt = (arr) => arr.filter(i => {
    if (!search) return true;
    const t = search.toLowerCase();
    return [i.title, i.description, i.auction_house, i.lot_number, i.sold_buyer].some(f => f?.toLowerCase?.().includes(t));
  });

  const activeTab = subTab || tab;

  if (loading) return (
    <div className="fade-in" style={S.splash}>
      <div style={S.splashIcon}>
        <svg width="48" height="48" viewBox="0 0 28 28" fill="none"><rect width="28" height="28" rx="6" fill="#F59E0B"/><path d="M7 19L14 7l7 12H7z" fill="#0F172A"/><circle cx="14" cy="15" r="2" fill="#F59E0B"/></svg>
      </div>
      <p style={{ color: '#F59E0B', fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>Auction Vault</p>
      <div style={S.spinner} />
    </div>
  );

  return (
    <div style={S.app}>
      {/* ─── Header ─── */}
      <header style={S.header} className="safe-top">
        <div style={S.headerRow}>
          <svg width="22" height="22" viewBox="0 0 28 28" fill="none"><rect width="28" height="28" rx="6" fill="#F59E0B"/><path d="M7 19L14 7l7 12H7z" fill="#0F172A"/><circle cx="14" cy="15" r="2" fill="#F59E0B"/></svg>
          <span style={S.headerTitle}>Auction Vault</span>
        </div>
        <div style={S.headerStats}>
          <span style={S.statChip}><span style={S.statVal}>{items.length}</span> stock</span>
          <span style={{...S.statChip, color: '#10B981'}}>{fmt(totalProfit)}</span>
        </div>
      </header>

      {/* ─── Toast ─── */}
      {toast && <div className="fade-in" style={{...S.toast, background: toast.type === 'success' ? '#065F46' : toast.type === 'error' ? '#991B1B' : '#1E3A5F'}}>
        {toast.type === 'info' && <div style={S.miniSpin}/>}
        {toast.type === 'success' && '✅ '}{toast.type === 'error' && '❌ '}{toast.msg}
      </div>}

      {/* ─── Main Content ─── */}
      <main style={S.content} className="safe-bottom">

        {/* UPLOAD */}
        {activeTab === 'upload' && <div className="fade-in">
          <div style={S.uploadArea}>
            <svg width="48" height="48" viewBox="0 0 64 64" fill="none" style={{marginBottom:12}}><rect x="8" y="16" width="48" height="40" rx="4" stroke="#F59E0B" strokeWidth="2.5" fill="none"/><path d="M24 36l8-10 8 10" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/><line x1="32" y1="28" x2="32" y2="48" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round"/></svg>
            <h2 style={S.uploadTitle}>Upload Invoice</h2>
            <p style={S.mutedText}>PDF or photo — AI extracts everything</p>
            <label style={S.primaryBtn} role="button">
              <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={handleUpload} style={{display:'none'}}/>
              📄 Choose File
            </label>
            <p style={{fontSize:11,color:'var(--text-hint)',marginTop:8}}>~$0.03 per invoice • Files saved permanently</p>
          </div>
          <div style={S.stepsRow}>
            {['📄 Upload','🤖 AI Parse','📦 Inventory','📸 Photos','💰 Sell','🧾 Receipt','📧 Send'].map((s,i)=>
              <div key={i} style={S.stepDot}><span style={{fontSize:16}}>{s.split(' ')[0]}</span><span style={{fontSize:9,color:'var(--text-muted)'}}>{s.split(' ').slice(1).join(' ')}</span></div>
            )}
          </div>
        </div>}

        {/* INVOICES */}
        {activeTab === 'invoices' && <div className="fade-in">
          <h2 style={S.pageTitle}>Invoices <span style={S.count}>{invoices.length}</span></h2>
          {invoices.length === 0 ? <Empty/> : invoices.map((inv, i) => (
            <div key={inv.id} className="fade-in" style={{...S.listCard, animationDelay: `${i*50}ms`}}>
              <div style={S.listCardTop}>
                <div style={{flex:1}}>
                  <p style={S.listTitle}>{inv.auction_house}</p>
                  <p style={S.listSub}>{fmtDate(inv.date)} • {inv.invoice_number}</p>
                  <p style={S.listSub}>{inv.itemCount} items • {inv.event_description?.slice(0,50)}</p>
                </div>
                <div style={{textAlign:'right'}}>
                  <p style={{...S.listAmount, color:'var(--accent)'}}>{fmt(inv.grand_total)}</p>
                  <Chip text={inv.payment_status||'?'} ok={inv.payment_status==='Paid'}/>
                </div>
              </div>
              <div style={S.listCardActions}>
                <button style={S.tinyBtn} onClick={()=>handleViewInvoice(inv)}>👁 View Original</button>
                <button style={S.tinyBtn} onClick={()=>{setTab('inventory');setSearch(inv.auction_house);}}>📦 Items</button>
                <button style={{...S.tinyBtn,color:'var(--red)'}} onClick={()=>handleDeleteInvoice(inv.id)}>🗑</button>
              </div>
            </div>
          ))}
        </div>}

        {/* INVENTORY */}
        {activeTab === 'inventory' && <div className="fade-in">
          <h2 style={S.pageTitle}>Inventory <span style={S.count}>{items.length}</span></h2>
          <input style={S.searchBar} placeholder="🔍 Search items..." value={search} onChange={e=>setSearch(e.target.value)}/>
          {filt(items).length === 0 ? <Empty text={search?'No matches':'Upload an invoice to start'}/> :
            filt(items).map((item,i) => (
              <div key={item.id} className="fade-in" style={{...S.itemCard, animationDelay:`${i*30}ms`}}>
                <div style={S.itemTop}>
                  {item.images?.length > 0 ? (
                    <div style={S.itemThumb}><img src={item.images[0].data} alt="" style={S.thumbImg}/></div>
                  ) : (
                    <div style={{...S.itemThumb, ...S.noThumb}} onClick={()=>setImgModal(item.id)}>📷</div>
                  )}
                  <div style={{flex:1,minWidth:0}}>
                    <p style={S.itemTitle}>{item.title}</p>
                    <p style={S.itemSub}>{item.auction_house} • Lot #{item.lot_number}</p>
                    <p style={S.itemSub}>{fmtDate(item.date)}</p>
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    <p style={{...S.mono, fontSize:11, color:'var(--text-muted)'}}>Hammer {fmt(item.hammer_price)}</p>
                    <p style={{...S.mono, fontSize:15, fontWeight:700, color:'var(--accent)'}}>{fmt(item.total_cost)}</p>
                    <p style={{...S.mono, fontSize:10, color:'var(--text-muted)'}}>+{fmt(item.premium_amount)} prem +{fmt(item.tax_amount)} tax</p>
                  </div>
                </div>
                <div style={S.itemActions}>
                  <button style={S.actionBtn} onClick={()=>setImgModal(item.id)}>📷 Photo</button>
                  <button style={{...S.actionBtn,...S.sellActionBtn}} onClick={()=>setSellModal(item.id)}>💰 Sell</button>
                  <button style={S.actionBtn} onClick={()=>{setLcItem(item);setSubTab('lifecycle');}}>🔄</button>
                </div>
              </div>
            ))
          }
        </div>}

        {/* SOLD */}
        {activeTab === 'sold' && <div className="fade-in">
          <h2 style={S.pageTitle}>Sold <span style={{...S.count,background:'rgba(16,185,129,.15)',color:'#10B981'}}>{sold.length}</span></h2>
          {sold.length===0 ? <Empty text="No sales yet"/> : sold.map((si,i) => (
            <div key={si.id} className="fade-in" style={{...S.listCard, animationDelay:`${i*30}ms`}}>
              <div style={S.listCardTop}>
                <div style={{flex:1,minWidth:0}}>
                  <p style={S.listTitle}>{si.title}</p>
                  <p style={S.listSub}>{si.sold_buyer||'Walk-in'} • {si.sold_platform||'Direct'} • {fmtTs(si.sold_at)}</p>
                  <p style={{...S.mono,fontSize:10,color:'var(--text-muted)',marginTop:2}}>{si.receipt_number}</p>
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                  <p style={{...S.mono,fontSize:14,fontWeight:700}}>{fmt(si.sold_price)}</p>
                  <p style={{...S.mono,fontSize:12,fontWeight:700,color:si.profit>=0?'var(--green)':'var(--red)'}}>{si.profit>=0?'+':''}{fmt(si.profit)}</p>
                  <p style={{fontSize:10,color:si.profit_pct>=0?'var(--green)':'var(--red)',fontWeight:600}}>{si.profit_pct>=0?'+':''}{si.profit_pct}% ROI</p>
                </div>
              </div>
              <div style={S.listCardActions}>
                <button style={S.tinyBtn} onClick={()=>handleGenReceipt(si)}>🧾 Receipt</button>
                <button style={S.tinyBtn} onClick={()=>setShareModal(si.id)}>📤 Share</button>
                <button style={S.tinyBtn} onClick={()=>{setLcItem(si);setSubTab('lifecycle');}}>🔄 Timeline</button>
              </div>
            </div>
          ))}
          {sold.length>0 && <div style={S.summaryBar}>
            <div><span style={{fontSize:10,color:'var(--text-muted)'}}>TOTAL COST</span><p style={S.mono}>{fmt(sold.reduce((s,i)=>s+(i.total_cost||0),0))}</p></div>
            <div><span style={{fontSize:10,color:'var(--text-muted)'}}>REVENUE</span><p style={{...S.mono,fontWeight:700}}>{fmt(totalRev)}</p></div>
            <div><span style={{fontSize:10,color:'var(--text-muted)'}}>PROFIT</span><p style={{...S.mono,fontWeight:700,color:totalProfit>=0?'var(--green)':'var(--red)'}}>{totalProfit>=0?'+':''}{fmt(totalProfit)}</p></div>
          </div>}
        </div>}

        {/* RECEIPTS */}
        {activeTab === 'receipts' && <div className="fade-in">
          <h2 style={S.pageTitle}>Receipts</h2>
          <p style={{color:'var(--text-muted)',fontSize:13,marginBottom:12}}>Generate, print, email, or WhatsApp receipts to customers.</p>
          {sold.length===0 ? <Empty text="Sell an item first"/> : sold.map(si=>(
            <div key={si.id} style={S.listCard}>
              <div style={S.listCardTop}>
                <div style={{flex:1}}><p style={S.listTitle}>{si.title}</p><p style={S.listSub}>{si.receipt_number} • {si.sold_buyer||'Walk-in'}</p></div>
                <p style={{...S.mono,fontSize:16,fontWeight:700,color:'var(--accent)'}}>{fmt(si.sold_price)}</p>
              </div>
              <div style={S.listCardActions}>
                <button style={S.tinyBtn} onClick={()=>handleGenReceipt(si)}>🧾 Generate</button>
                <button style={S.tinyBtn} onClick={()=>setShareModal(si.id)}>📤 Share</button>
              </div>
            </div>
          ))}
        </div>}

        {/* LIFECYCLE */}
        {activeTab === 'lifecycle' && <div className="fade-in">
          <h2 style={S.pageTitle}>Lifecycle</h2>
          {!lcItem ? <div>
            <p style={{color:'var(--text-muted)',fontSize:12,marginBottom:10}}>Tap any item to see its full journey:</p>
            {allItems.map(i=><button key={i.id} style={S.lcRow} onClick={()=>setLcItem(i)}>
              <Chip text={i.status==='sold'?'Sold':'Stock'} ok={i.status==='sold'}/>
              <span style={{flex:1,textAlign:'left',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'var(--text-primary)',fontSize:13,fontWeight:500}}>{i.title}</span>
              <span style={{fontSize:10,color:'var(--text-muted)',flexShrink:0}}>{i.auction_house}</span>
            </button>)}
          </div> : <div>
            <button onClick={()=>setLcItem(null)} style={S.backBtn}>← Back</button>
            <div style={{marginBottom:16}}>
              <h3 style={{fontSize:16,fontFamily:'var(--font-display)',color:'var(--text-primary)',margin:'0 0 4px'}}>{lcItem.title}</h3>
              <p style={{fontSize:12,color:'var(--text-muted)'}}>{lcItem.auction_house} • Lot #{lcItem.lot_number}</p>
              <Chip text={lcItem.status==='sold'?'Sold':'In Stock'} ok={lcItem.status==='sold'} style={{marginTop:6}}/>
            </div>
            <div style={S.numRow}>
              <NB l="Hammer" v={fmt(lcItem.hammer_price)}/><NB l="Premium" v={fmt(lcItem.premium_amount)}/><NB l="Tax" v={fmt(lcItem.tax_amount)}/><NB l="Cost" v={fmt(lcItem.total_cost)} hi/>
              {lcItem.status==='sold'&&<><NB l="Sold For" v={fmt(lcItem.sold_price)} hi/><NB l="Profit" v={`${lcItem.profit>=0?'+':''}${fmt(lcItem.profit)}`} c={lcItem.profit>=0?'var(--green)':'var(--red)'}/></>}
            </div>
            <h4 style={{color:'var(--accent)',margin:'16px 0 8px',fontFamily:'var(--font-display)',fontSize:13}}>Timeline</h4>
            <div style={S.timeline}>{lcItem.lifecycle?.map((ev,i)=><div key={i} style={S.tlEntry}>
              <div style={S.tlDot}>{i===lcItem.lifecycle.length-1?'●':'○'}</div>
              <div><p style={{fontSize:13,fontWeight:500,color:'var(--text-primary)'}}>{ev.event}</p><p style={{fontSize:10,color:'var(--text-muted)'}}>{fmtTs(ev.ts)}</p><p style={{fontSize:11,color:'var(--text-secondary)'}}>{ev.detail}</p></div>
            </div>)}</div>
            {lcItem.images?.length>0&&<div style={{marginTop:14}}>
              <h4 style={{color:'var(--accent)',fontSize:13,marginBottom:6,fontFamily:'var(--font-display)'}}>Photos</h4>
              <div style={{display:'flex',gap:6,overflowX:'auto',paddingBottom:4}}>{lcItem.images.map((img,i)=><img key={i} src={img.data} alt="" style={{width:72,height:72,objectFit:'cover',borderRadius:8,border:'2px solid var(--border)',flexShrink:0}}/>)}</div>
            </div>}
          </div>}
        </div>}

        {/* ANALYTICS */}
        {activeTab === 'analytics' && <div className="fade-in">
          <h2 style={S.pageTitle}>Analytics</h2>
          <div style={S.metricGrid}>
            <MC t="Invested" v={fmt(totalSpent)} i="💰" s={`${invoices.length} invoices`}/>
            <MC t="In Stock" v={fmt(items.reduce((s,i)=>s+(i.total_cost||0),0))} i="📦" s={`${items.length} items`}/>
            <MC t="Revenue" v={fmt(totalRev)} i="📈" s={`${sold.length} sold`}/>
            <MC t="Profit" v={`${totalProfit>=0?'+':''}${fmt(totalProfit)}`} i={totalProfit>=0?'🟢':'🔴'} c={totalProfit>=0?'var(--green)':'var(--red)'} s={totalSpent>0?`${((totalProfit/totalSpent)*100).toFixed(1)}% ROI`:''}/>
          </div>
          <h4 style={{color:'var(--text-primary)',margin:'16px 0 8px',fontFamily:'var(--font-display)',fontSize:13}}>By auction house</h4>
          {Object.entries(allItems.reduce((a,i)=>{const k=i.auction_house||'?';if(!a[k])a[k]={n:0,t:0};a[k].n++;a[k].t+=i.total_cost||0;return a;},{})).sort((a,b)=>b[1].t-a[1].t).map(([h,d])=>
            <div key={h} style={S.anaRow}><span style={{flex:1,fontSize:13,fontWeight:500}}>{h}</span><span style={{...S.mono,fontSize:11,color:'var(--text-muted)'}}>{d.n} items</span><span style={{...S.mono,fontSize:13,fontWeight:600,marginLeft:12}}>{fmt(d.t)}</span></div>
          )}
        </div>}

        {/* SETTINGS */}
        {activeTab === 'settings' && <div className="fade-in">
          <h2 style={S.pageTitle}>Settings</h2>
          <div style={S.settingsCard}>
            <h3 style={{fontSize:14,color:'var(--accent)',fontFamily:'var(--font-display)',margin:'0 0 12px'}}>Business Info (appears on receipts)</h3>
            <Lbl t="Business / Your Name"/><input style={S.input} value={biz.name} onChange={e=>setBiz({...biz,name:e.target.value})} placeholder="Your name or business"/>
            <Lbl t="Address"/><input style={S.input} value={biz.address} onChange={e=>setBiz({...biz,address:e.target.value})} placeholder="Street, City, Province"/>
            <Lbl t="Phone"/><input style={S.input} value={biz.phone} onChange={e=>setBiz({...biz,phone:e.target.value})} placeholder="+1 xxx-xxx-xxxx"/>
            <Lbl t="Email"/><input style={S.input} value={biz.email} onChange={e=>setBiz({...biz,email:e.target.value})} placeholder="you@email.com"/>
            <Lbl t="HST # (optional)"/><input style={S.input} value={biz.hst} onChange={e=>setBiz({...biz,hst:e.target.value})} placeholder="123456789RT0001"/>
            <button style={{...S.primaryBtn,width:'100%',marginTop:14}} onClick={saveBiz}>Save Business Info ✓</button>
          </div>
          <button style={S.dangerBtn} onClick={handleReset}>🗑 Reset All Data</button>
        </div>}

        {/* MORE MENU */}
        {activeTab === 'more' && !subTab && <div className="fade-in">
          <h2 style={S.pageTitle}>More</h2>
          {[
            {id:'lifecycle',icon:'🔄',t:'Lifecycle Tracker',d:'Full journey of every item'},
            {id:'analytics',icon:'📊',t:'Analytics',d:'Spending, revenue, and profit'},
            {id:'settings',icon:'⚙',t:'Settings',d:'Business info for receipts'},
          ].map(m=><button key={m.id} style={S.menuRow} onClick={()=>setSubTab(m.id)}>
            <span style={{fontSize:22}}>{m.icon}</span>
            <div><p style={{fontSize:14,fontWeight:500,color:'var(--text-primary)',textAlign:'left'}}>{m.t}</p><p style={{fontSize:11,color:'var(--text-muted)',textAlign:'left'}}>{m.d}</p></div>
            <span style={{color:'var(--text-muted)',fontSize:18,marginLeft:'auto'}}>›</span>
          </button>)}
        </div>}
      </main>

      {/* ─── Bottom Nav ─── */}
      <nav style={S.bottomNav} className="safe-bottom">
        {TABS.map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setSubTab(null); setLcItem(null); }} style={{...S.navItem, ...(tab===t.id ? S.navItemActive : {})}}>
            <span style={{fontSize:20}}>{t.icon}</span>
            <span style={{fontSize:9,fontWeight:tab===t.id?700:400}}>{t.label}</span>
            {t.id==='inventory'&&items.length>0&&<span style={S.navBadge}>{items.length}</span>}
            {t.id==='sold'&&sold.length>0&&<span style={{...S.navBadge,background:'var(--green)'}}>{sold.length}</span>}
          </button>
        ))}
      </nav>

      {/* ═══ MODALS ═══ */}

      {/* SELL */}
      {sellModal && <Modal close={()=>setSellModal(null)}>
        <h3 style={S.modalTitle}>💰 Record Sale</h3>
        <p style={{fontSize:14,fontWeight:600,color:'var(--text-primary)',margin:'0 0 2px'}}>{items.find(i=>i.id===sellModal)?.title}</p>
        <p style={{fontSize:11,color:'var(--text-muted)',margin:'0 0 14px'}}>Cost: {fmt(items.find(i=>i.id===sellModal)?.total_cost)}</p>
        <Lbl t="Sale Amount (CAD) *"/><input style={S.input} type="number" step="0.01" placeholder="0.00" value={sf.amount} onChange={e=>setSf({...sf,amount:e.target.value})} autoFocus/>
        <Lbl t="Platform"/><input style={S.input} placeholder="Facebook, Kijiji, eBay..." value={sf.platform} onChange={e=>setSf({...sf,platform:e.target.value})}/>
        <Lbl t="Buyer Name"/><input style={S.input} placeholder="Customer name" value={sf.buyer} onChange={e=>setSf({...sf,buyer:e.target.value})}/>
        <Lbl t="Buyer Email"/><input style={S.input} type="email" placeholder="email@example.com" value={sf.buyerEmail} onChange={e=>setSf({...sf,buyerEmail:e.target.value})}/>
        <Lbl t="Buyer Phone"/><input style={S.input} type="tel" placeholder="+1 xxx-xxx-xxxx" value={sf.buyerPhone} onChange={e=>setSf({...sf,buyerPhone:e.target.value})}/>
        {sf.amount && <div style={S.profitPrev}><span>Profit:</span><strong style={{color:(parseFloat(sf.amount)-(items.find(i=>i.id===sellModal)?.total_cost||0))>=0?'var(--green)':'var(--red)'}}>{(()=>{const p=parseFloat(sf.amount)-(items.find(i=>i.id===sellModal)?.total_cost||0);return`${p>=0?'+':''}${fmt(p)}`;})()}</strong></div>}
        <div style={S.modalBtns}><button style={S.cancelBtn} onClick={()=>setSellModal(null)}>Cancel</button><button style={S.confirmBtn} onClick={handleSell} disabled={!sf.amount}>Confirm Sale ✓</button></div>
      </Modal>}

      {/* IMAGE */}
      {imgModal && <Modal close={()=>setImgModal(null)}>
        <h3 style={S.modalTitle}>📷 Product Photos</h3>
        <label style={{...S.primaryBtn,display:'block',textAlign:'center'}} role="button"><input type="file" accept="image/*" multiple onChange={e=>handleImg(imgModal,e)} style={{display:'none'}}/>Choose Images</label>
        {items.find(i=>i.id===imgModal)?.images?.length>0&&<div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:12}}>{items.find(i=>i.id===imgModal).images.map((img,i)=><img key={i} src={img.data} alt="" style={{width:64,height:64,objectFit:'cover',borderRadius:8,border:'2px solid var(--border)'}}/>)}</div>}
        <button style={{...S.cancelBtn,width:'100%',marginTop:12}} onClick={()=>setImgModal(null)}>Done</button>
      </Modal>}

      {/* VIEW ORIGINAL INVOICE */}
      {viewInvoiceModal && <Modal close={()=>{setViewInvoiceModal(null);setViewInvoiceData(null);}}>
        <h3 style={S.modalTitle}>📄 Original Invoice</h3>
        <p style={{fontSize:12,color:'var(--text-muted)',margin:'0 0 12px'}}>{viewInvoiceModal.fileName} • Uploaded {fmtTs(viewInvoiceModal.uploadedAt)}</p>
        {!viewInvoiceData ? <div style={{textAlign:'center',padding:24}}><div style={S.spinner}/></div> :
          viewInvoiceData.fileType?.includes('pdf') ? (
            <iframe src={`data:application/pdf;base64,${viewInvoiceData.data}`} style={{width:'100%',height:'60vh',borderRadius:8,border:'1px solid var(--border)'}}/>
          ) : (
            <img src={`data:${viewInvoiceData.fileType};base64,${viewInvoiceData.data}`} alt="" style={{width:'100%',borderRadius:8,border:'1px solid var(--border)'}}/>
          )
        }
      </Modal>}

      {/* RECEIPT PREVIEW */}
      {receiptModal && <Modal close={()=>{setReceiptModal(null);setReceiptHtml('');}}>
        <h3 style={S.modalTitle}>🧾 Receipt</h3>
        {receiptLoading ? <div style={{textAlign:'center',padding:32}}><div style={S.spinner}/><p style={{color:'var(--text-muted)',marginTop:10,fontSize:12}}>Claude generating receipt...</p></div> :
        <div>
          <div style={{background:'#fff',borderRadius:8,padding:4,maxHeight:'50vh',overflow:'auto',marginBottom:12}} dangerouslySetInnerHTML={{__html:receiptHtml}}/>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            <button style={S.primaryBtn} onClick={()=>printHTML(receiptHtml)}>🖨 Print PDF</button>
            <button style={S.accentBtn} onClick={()=>{const si=sold.find(i=>i.id===receiptModal);if(si?.sold_buyer_email)setEmailTo(si.sold_buyer_email);setEmailModal(true);setShareModal(receiptModal);}}>📧 Email</button>
            <button style={S.ghostBtn} onClick={()=>{const si=sold.find(i=>i.id===receiptModal);if(si)openWhatsApp(si.sold_buyer_phone,buildReceiptText(si,biz));}}>📱 WhatsApp</button>
            <button style={S.ghostBtn} onClick={()=>{const si=sold.find(i=>i.id===receiptModal);if(si){navigator.clipboard?.writeText(buildReceiptText(si,biz));showToast('success','Copied!');}}}>📋 Copy</button>
          </div>
        </div>}
      </Modal>}

      {/* SHARE */}
      {shareModal && !receiptModal && !emailModal && <Modal close={()=>setShareModal(null)}>
        {(()=>{const si=sold.find(i=>i.id===shareModal);if(!si)return null;return<div>
          <h3 style={S.modalTitle}>📤 Share</h3>
          <p style={{fontSize:14,fontWeight:600,margin:'0 0 4px',color:'var(--text-primary)'}}>{si.title}</p>
          <p style={{fontSize:11,color:'var(--text-muted)',margin:'0 0 14px'}}>{si.receipt_number} • {fmt(si.sold_price)}</p>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            <button style={S.shareRow} onClick={()=>handleGenReceipt(si)}>🧾 Generate & Preview Receipt</button>
            <button style={S.shareRow} onClick={()=>{if(si.sold_buyer_email)setEmailTo(si.sold_buyer_email);setEmailModal(true);}}>📧 Email via Gmail</button>
            <button style={S.shareRow} onClick={()=>openWhatsApp(si.sold_buyer_phone,buildReceiptText(si,biz))}>📱 WhatsApp</button>
            <button style={S.shareRow} onClick={()=>openSMS(si.sold_buyer_phone,buildReceiptText(si,biz))}>💬 SMS / iMessage</button>
            <button style={S.shareRow} onClick={()=>{navigator.clipboard?.writeText(buildReceiptText(si,biz));showToast('success','Copied!');}}>📋 Copy Text</button>
          </div>
        </div>;})()}
      </Modal>}

      {/* EMAIL */}
      {emailModal && <Modal close={()=>{setEmailModal(null);setEmailTo('');}}>
        <h3 style={S.modalTitle}>📧 Email Receipt</h3>
        <p style={{fontSize:11,color:'var(--text-muted)',margin:'0 0 12px'}}>Via your connected Gmail</p>
        <Lbl t="Recipient Email *"/><input style={S.input} type="email" placeholder="customer@email.com" value={emailTo} onChange={e=>setEmailTo(e.target.value)} autoFocus/>
        <div style={S.modalBtns}><button style={S.cancelBtn} onClick={()=>{setEmailModal(null);setEmailTo('');}}>Cancel</button><button style={S.confirmBtn} onClick={handleEmail} disabled={!emailTo||emailSending}>{emailSending?'Sending...':'Send 📧'}</button></div>
      </Modal>}
    </div>
  );
}

// ─── Sub Components ───
function Modal({close, children}) {
  return <div style={S.overlay} onClick={close}><div className="slide-up" style={S.modal} onClick={e=>e.stopPropagation()}><div style={S.modalHandle}/>{children}</div></div>;
}
function Chip({text, ok, style:extra}) { return <span style={{display:'inline-block',padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:600,background:ok?'rgba(16,185,129,.15)':'rgba(239,68,68,.15)',color:ok?'var(--green)':'var(--red)',...extra}}>{text}</span>; }
function Empty({text='No data yet'}) { return <div style={{textAlign:'center',padding:40,color:'var(--text-muted)'}}><p style={{fontSize:32,marginBottom:6}}>📭</p><p style={{fontSize:13}}>{text}</p></div>; }
function Lbl({t}) { return <label style={{display:'block',color:'var(--text-muted)',fontSize:10,textTransform:'uppercase',letterSpacing:1,margin:'10px 0 3px'}}>{t}</label>; }
function NB({l,v,hi,c}) { return <div style={{background:'var(--bg-surface)',borderRadius:10,padding:'8px 12px',display:'flex',flexDirection:'column',gap:2,minWidth:0,flex:'1 1 70px',border:hi?'1px solid rgba(245,158,11,.2)':'1px solid var(--border)'}}><span style={{fontSize:8,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:1}}>{l}</span><span style={{fontSize:13,fontWeight:700,fontFamily:'var(--font-mono)',color:c||(hi?'var(--accent)':'var(--text-primary)')}}>{v}</span></div>; }
function MC({t,v,i,s,c}) { return <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3,padding:16,background:'var(--bg-card)',borderRadius:14,border:'1px solid var(--border)',textAlign:'center'}}><span style={{fontSize:20}}>{i}</span><span style={{color:'var(--text-muted)',fontSize:9,textTransform:'uppercase',letterSpacing:1}}>{t}</span><span style={{color:c||'var(--text-primary)',fontSize:17,fontWeight:700,fontFamily:'var(--font-mono)'}}>{v}</span>{s&&<span style={{color:'var(--text-muted)',fontSize:10}}>{s}</span>}</div>; }

// ─── Styles ───
const S = {
  app: { display:'flex',flexDirection:'column',height:'100%',background:'var(--bg-app)' },
  splash: { display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100vh',background:'var(--bg-app)',gap:12 },
  splashIcon: { marginBottom:8 },
  spinner: { width:28,height:28,border:'3px solid var(--border)',borderTopColor:'var(--accent)',borderRadius:'50%',animation:'spin .8s linear infinite' },
  miniSpin: { width:14,height:14,border:'2px solid rgba(255,255,255,.3)',borderTopColor:'#fff',borderRadius:'50%',animation:'spin .6s linear infinite',flexShrink:0 },

  header: { display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 16px',background:'var(--bg-card)',borderBottom:'1px solid var(--border)',flexShrink:0,zIndex:10 },
  headerRow: { display:'flex',alignItems:'center',gap:8 },
  headerTitle: { fontSize:16,fontFamily:'var(--font-display)',color:'var(--accent)',fontWeight:700 },
  headerStats: { display:'flex',gap:6 },
  statChip: { fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-secondary)',fontWeight:500 },
  statVal: { fontWeight:700,color:'var(--text-primary)' },

  toast: { position:'fixed',top:60,left:16,right:16,padding:'10px 16px',borderRadius:12,color:'#fff',fontSize:12,display:'flex',alignItems:'center',gap:8,zIndex:100,fontWeight:500 },

  content: { flex:1,overflow:'auto',padding:'12px 16px',paddingBottom:'calc(72px + env(safe-area-inset-bottom, 0px))' },

  bottomNav: { display:'flex',justifyContent:'space-around',alignItems:'center',background:'var(--bg-card)',borderTop:'1px solid var(--border)',position:'fixed',bottom:0,left:0,right:0,zIndex:50,paddingBottom:'env(safe-area-inset-bottom, 0px)' },
  navItem: { display:'flex',flexDirection:'column',alignItems:'center',gap:2,padding:'8px 0',minWidth:56,background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',fontFamily:'var(--font-sans)',position:'relative' },
  navItemActive: { color:'var(--accent)' },
  navBadge: { position:'absolute',top:4,right:8,background:'var(--blue)',color:'#fff',fontSize:8,padding:'1px 4px',borderRadius:10,fontWeight:700,minWidth:14,textAlign:'center' },

  pageTitle: { fontSize:20,fontFamily:'var(--font-display)',color:'var(--accent)',fontWeight:700,margin:'0 0 12px',display:'flex',alignItems:'center',gap:8 },
  count: { background:'rgba(245,158,11,.15)',color:'var(--accent)',padding:'2px 10px',borderRadius:8,fontSize:13,fontWeight:700,fontFamily:'var(--font-mono)' },

  uploadArea: { display:'flex',flexDirection:'column',alignItems:'center',padding:'32px 20px',background:'var(--bg-card)',borderRadius:16,border:'2px dashed var(--border-hover)',textAlign:'center',marginBottom:20 },
  uploadTitle: { fontFamily:'var(--font-display)',fontSize:18,color:'var(--accent)',margin:'0 0 4px' },
  mutedText: { color:'var(--text-muted)',fontSize:13,margin:'0 0 16px' },
  primaryBtn: { display:'inline-block',padding:'12px 28px',background:'var(--accent)',color:'#0F172A',borderRadius:12,fontWeight:700,fontSize:14,cursor:'pointer',fontFamily:'var(--font-sans)',border:'none',textAlign:'center' },
  accentBtn: { padding:'12px 16px',background:'rgba(245,158,11,.15)',border:'1px solid rgba(245,158,11,.3)',borderRadius:12,color:'var(--accent)',cursor:'pointer',fontSize:13,fontWeight:600,fontFamily:'var(--font-sans)',textAlign:'center' },
  ghostBtn: { padding:'12px 16px',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,color:'var(--text-secondary)',cursor:'pointer',fontSize:13,fontFamily:'var(--font-sans)',textAlign:'center' },
  dangerBtn: { width:'100%',padding:'14px',background:'rgba(239,68,68,.1)',border:'1px solid rgba(239,68,68,.3)',borderRadius:12,color:'var(--red)',cursor:'pointer',fontSize:14,fontFamily:'var(--font-sans)',marginTop:20 },

  stepsRow: { display:'flex',gap:8,overflowX:'auto',paddingBottom:4 },
  stepDot: { display:'flex',flexDirection:'column',alignItems:'center',gap:2,padding:'10px 8px',background:'var(--bg-card)',borderRadius:12,border:'1px solid var(--border)',minWidth:60,flexShrink:0 },

  searchBar: { width:'100%',padding:'10px 14px',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,color:'var(--text-primary)',fontSize:14,outline:'none',fontFamily:'var(--font-sans)',marginBottom:12,boxSizing:'border-box' },

  listCard: { background:'var(--bg-card)',borderRadius:14,border:'1px solid var(--border)',marginBottom:10,overflow:'hidden' },
  listCardTop: { display:'flex',justifyContent:'space-between',alignItems:'flex-start',padding:'12px 14px',gap:10 },
  listTitle: { fontSize:14,fontWeight:600,color:'var(--text-primary)',margin:'0 0 2px' },
  listSub: { fontSize:11,color:'var(--text-muted)',margin:0 },
  listAmount: { fontSize:16,fontWeight:700,fontFamily:'var(--font-mono)',margin:'0 0 4px' },
  listCardActions: { display:'flex',gap:6,padding:'8px 14px',borderTop:'1px solid var(--border)' },
  tinyBtn: { padding:'6px 10px',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:8,color:'var(--text-secondary)',cursor:'pointer',fontSize:11,fontFamily:'var(--font-sans)' },

  itemCard: { background:'var(--bg-card)',borderRadius:14,border:'1px solid var(--border)',marginBottom:10,overflow:'hidden' },
  itemTop: { display:'flex',gap:10,padding:'12px 14px',alignItems:'flex-start' },
  itemThumb: { width:56,height:56,borderRadius:10,overflow:'hidden',flexShrink:0 },
  thumbImg: { width:'100%',height:'100%',objectFit:'cover' },
  noThumb: { background:'var(--bg-surface)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,cursor:'pointer' },
  itemTitle: { fontSize:14,fontWeight:600,color:'var(--text-primary)',margin:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' },
  itemSub: { fontSize:11,color:'var(--text-muted)',margin:0 },
  itemActions: { display:'flex',gap:6,padding:'8px 14px',borderTop:'1px solid var(--border)' },
  actionBtn: { padding:'7px 12px',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:10,color:'var(--text-secondary)',cursor:'pointer',fontSize:12,fontFamily:'var(--font-sans)' },
  sellActionBtn: { flex:1,background:'rgba(245,158,11,.1)',border:'1px solid rgba(245,158,11,.3)',color:'var(--accent)',fontWeight:600 },

  summaryBar: { display:'flex',justifyContent:'space-around',padding:'14px',background:'var(--bg-card)',borderRadius:14,border:'1px solid var(--border)',marginTop:8 },
  mono: { fontFamily:'var(--font-mono)',fontSize:13,margin:0 },

  numRow: { display:'flex',gap:6,flexWrap:'wrap' },
  timeline: { borderLeft:'2px solid var(--border)',marginLeft:6,paddingLeft:14 },
  tlEntry: { display:'flex',gap:8,padding:'8px 0',position:'relative' },
  tlDot: { position:'absolute',left:-21,top:11,color:'var(--accent)',fontSize:8 },

  metricGrid: { display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:10 },

  anaRow: { display:'flex',alignItems:'center',padding:'10px 14px',background:'var(--bg-card)',borderRadius:10,border:'1px solid var(--border)',marginBottom:6 },

  menuRow: { display:'flex',alignItems:'center',gap:12,padding:'14px 16px',background:'var(--bg-card)',borderRadius:14,border:'1px solid var(--border)',cursor:'pointer',width:'100%',fontFamily:'var(--font-sans)',marginBottom:8 },

  lcRow: { display:'flex',alignItems:'center',gap:8,padding:'10px 12px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:10,cursor:'pointer',width:'100%',fontFamily:'var(--font-sans)',marginBottom:4 },
  backBtn: { background:'none',border:'1px solid var(--border)',borderRadius:8,padding:'6px 12px',color:'var(--text-secondary)',cursor:'pointer',marginBottom:12,fontSize:12,fontFamily:'var(--font-sans)' },

  settingsCard: { background:'var(--bg-card)',borderRadius:14,border:'1px solid var(--border)',padding:16 },

  shareRow: { padding:'12px 14px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:12,color:'var(--text-primary)',cursor:'pointer',fontSize:13,fontFamily:'var(--font-sans)',textAlign:'left',width:'100%' },

  overlay: { position:'fixed',inset:0,background:'rgba(0,0,0,.6)',display:'flex',alignItems:'flex-end',justifyContent:'center',zIndex:200,padding:0 },
  modal: { background:'var(--bg-surface)',borderRadius:'20px 20px 0 0',padding:'8px 20px 24px',width:'100%',maxWidth:500,maxHeight:'90vh',overflow:'auto',position:'relative' },
  modalHandle: { width:36,height:4,background:'var(--border-hover)',borderRadius:4,margin:'0 auto 12px' },
  modalTitle: { fontSize:16,fontFamily:'var(--font-display)',color:'var(--accent)',margin:'0 0 8px' },
  input: { width:'100%',padding:'10px 12px',background:'var(--bg-input)',border:'1px solid var(--border)',borderRadius:10,color:'var(--text-primary)',fontSize:14,outline:'none',fontFamily:'var(--font-mono)',boxSizing:'border-box' },
  profitPrev: { display:'flex',justifyContent:'space-between',padding:'8px 12px',background:'var(--bg-input)',borderRadius:10,marginTop:10,fontSize:13,color:'var(--text-muted)' },
  modalBtns: { display:'flex',gap:8,marginTop:14 },
  cancelBtn: { flex:1,padding:'12px',background:'none',border:'1px solid var(--border)',borderRadius:12,color:'var(--text-secondary)',cursor:'pointer',fontSize:13,fontFamily:'var(--font-sans)' },
  confirmBtn: { flex:1,padding:'12px',background:'var(--accent)',border:'none',borderRadius:12,color:'#0F172A',cursor:'pointer',fontSize:13,fontWeight:700,fontFamily:'var(--font-sans)' },
};
