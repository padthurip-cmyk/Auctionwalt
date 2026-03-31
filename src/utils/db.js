import { supabase } from './supabase';

// ─── Auth Helpers ───
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}

// ─── Invoices ───
export async function getInvoices() {
  const { data, error } = await supabase.from('invoices').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function insertInvoice(invoice) {
  const user = await getUser();
  const { data, error } = await supabase.from('invoices').insert({ ...invoice, user_id: user.id }).select().single();
  if (error) throw error;
  return data;
}

export async function deleteInvoice(id) {
  const { error } = await supabase.from('invoices').delete().eq('id', id);
  if (error) throw error;
}

// ─── Items (Inventory) ───
export async function getItems() {
  const { data, error } = await supabase.from('items').select('*').eq('status', 'in_inventory').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function insertItems(items) {
  const user = await getUser();
  const rows = items.map(i => ({ ...i, user_id: user.id }));
  const { data, error } = await supabase.from('items').insert(rows).select();
  if (error) throw error;
  return data || [];
}

export async function updateItem(id, updates) {
  const { data, error } = await supabase.from('items').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteItem(id) {
  const { error } = await supabase.from('items').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteItemsByInvoice(invoiceId) {
  const { error } = await supabase.from('items').delete().eq('invoice_id', invoiceId);
  if (error) throw error;
}

// ─── Sold Items ───
export async function getSoldItems() {
  const { data, error } = await supabase.from('sold_items').select('*').order('sold_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function insertSoldItem(soldItem) {
  const user = await getUser();
  const { data, error } = await supabase.from('sold_items').insert({ ...soldItem, user_id: user.id }).select().single();
  if (error) throw error;
  return data;
}

export async function updateSoldItem(id, updates) {
  const { data, error } = await supabase.from('sold_items').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// ─── Customers ───
export async function getCustomers() {
  const { data, error } = await supabase.from('customers').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function insertCustomer(customer) {
  const user = await getUser();
  const { data, error } = await supabase.from('customers').insert({ ...customer, user_id: user.id }).select().single();
  if (error) throw error;
  return data;
}

// ─── Lifecycle Events ───
export async function getLifecycle(itemId, soldItemId) {
  let query = supabase.from('lifecycle_events').select('*').order('created_at', { ascending: true });
  if (itemId) query = query.eq('item_id', itemId);
  if (soldItemId) query = query.eq('sold_item_id', soldItemId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function addLifecycleEvent(event) {
  const user = await getUser();
  const { error } = await supabase.from('lifecycle_events').insert({ ...event, user_id: user.id });
  if (error) throw error;
}

export async function addLifecycleEvents(events) {
  const user = await getUser();
  const rows = events.map(e => ({ ...e, user_id: user.id }));
  const { error } = await supabase.from('lifecycle_events').insert(rows);
  if (error) throw error;
}

// ─── Settings ───
export async function getSettings() {
  const { data, error } = await supabase.from('settings').select('*').maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertSettings(settings) {
  const user = await getUser();
  const { data, error } = await supabase.from('settings').upsert({ ...settings, user_id: user.id, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }).select().single();
  if (error) throw error;
  return data;
}

// ─── File Storage: Invoice Files ───
export async function uploadInvoiceFile(invoiceId, base64Data, fileName, fileType) {
  const user = await getUser();
  const ext = fileName.split('.').pop() || 'pdf';
  const path = `${user.id}/${invoiceId}.${ext}`;

  // Convert base64 to blob
  const byteChars = atob(base64Data);
  const byteArray = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
  const blob = new Blob([byteArray], { type: fileType });

  const { error } = await supabase.storage.from('invoice-files').upload(path, blob, { contentType: fileType, upsert: true });
  if (error) throw error;
  return path;
}

export async function getInvoiceFileUrl(filePath) {
  if (!filePath) return null;
  const { data, error } = await supabase.storage.from('invoice-files').createSignedUrl(filePath, 3600);
  if (error) throw error;
  return data?.signedUrl;
}

// ─── File Storage: Product Photos ───
export async function uploadPhoto(itemId, file) {
  const user = await getUser();
  const ext = file.name.split('.').pop() || 'jpg';
  const photoId = Date.now().toString(36);
  const path = `${user.id}/${itemId}/${photoId}.${ext}`;

  const { error } = await supabase.storage.from('product-photos').upload(path, file, { contentType: file.type, upsert: true });
  if (error) throw error;

  // Save metadata
  await supabase.from('item_photos').insert({ user_id: user.id, item_id: itemId, file_path: path, file_name: file.name });
  return path;
}

export async function uploadPhotoForSold(soldItemId, file) {
  const user = await getUser();
  const ext = file.name.split('.').pop() || 'jpg';
  const photoId = Date.now().toString(36);
  const path = `${user.id}/sold_${soldItemId}/${photoId}.${ext}`;

  const { error } = await supabase.storage.from('product-photos').upload(path, file, { contentType: file.type, upsert: true });
  if (error) throw error;

  await supabase.from('item_photos').insert({ user_id: user.id, sold_item_id: soldItemId, file_path: path, file_name: file.name });
  return path;
}

export async function getPhotoUrls(itemId, soldItemId) {
  let query = supabase.from('item_photos').select('*').order('created_at', { ascending: true });
  if (itemId) query = query.eq('item_id', itemId);
  if (soldItemId) query = query.eq('sold_item_id', soldItemId);
  const { data, error } = await query;
  if (error) throw error;

  const urls = await Promise.all((data || []).map(async (photo) => {
    const { data: urlData } = await supabase.storage.from('product-photos').createSignedUrl(photo.file_path, 3600);
    return { ...photo, url: urlData?.signedUrl };
  }));
  return urls;
}

// ─── Nuke Everything ───
export async function clearAllData() {
  const user = await getUser();
  if (!user) return;
  await supabase.from('lifecycle_events').delete().eq('user_id', user.id);
  await supabase.from('item_photos').delete().eq('user_id', user.id);
  await supabase.from('items').delete().eq('user_id', user.id);
  await supabase.from('sold_items').delete().eq('user_id', user.id);
  await supabase.from('invoices').delete().eq('user_id', user.id);
  await supabase.from('customers').delete().eq('user_id', user.id);
  await supabase.from('settings').delete().eq('user_id', user.id);
  // Storage cleanup
  const { data: invFiles } = await supabase.storage.from('invoice-files').list(user.id);
  if (invFiles?.length) await supabase.storage.from('invoice-files').remove(invFiles.map(f => `${user.id}/${f.name}`));
  const { data: photoFolders } = await supabase.storage.from('product-photos').list(user.id);
  if (photoFolders?.length) {
    for (const folder of photoFolders) {
      const { data: files } = await supabase.storage.from('product-photos').list(`${user.id}/${folder.name}`);
      if (files?.length) await supabase.storage.from('product-photos').remove(files.map(f => `${user.id}/${folder.name}/${f.name}`));
    }
  }
}
