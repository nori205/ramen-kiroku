// ============================================================
// ラーメン記録アプリ - Firebase連携ロジック
// ------------------------------------------------------------
// 【初回セットアップ手順】
//   1. https://console.firebase.google.com/ を開く
//   2. プロジェクト「ramen-kiroku」を選択
//   3. ⚙️プロジェクトの設定 > マイアプリ > Firebase SDK snippet
//   4. 下記の firebaseConfig を自分のプロジェクトの値に書き換える
//   5. Firestore Database を「テストモード」で作成する
// ============================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ============================================================
// ▼▼▼ Firebase設定（ここを書き換えてください） ▼▼▼
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyDBwyNsnDBNWY8MfhWxFck5huE3moWsItQ",
  authDomain: "ramen-kiroku.firebaseapp.com",
  projectId: "ramen-kiroku",
  storageBucket: "ramen-kiroku.firebasestorage.app",
  messagingSenderId: "457479226825",
  appId: "1:457479226825:web:211e1519755fdb05171418",
  measurementId: "G-TWNRYSNJM9",
};
// ============================================================
// ▲▲▲ Firebase設定ここまで ▲▲▲
// ============================================================

const COLLECTION = 'ramenRecords';

// ============================================================
// 都道府県リスト
// ============================================================
const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
  '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];

const RATING_LABELS = {
  1: 'いまいち',
  2: 'まあまあ',
  3: '普通',
  4: '美味しい！',
  5: '最高！',
};

// ============================================================
// アプリ状態
// ============================================================
let db;
let allRecords = [];
let editingDocId = null;
let unsubscribe = null;

// 写真データURL（圧縮後のbase64）
let newFormPhotoUrl = null;
let editFormPhotoUrl = null;
let newPhotoController = null;
let editPhotoController = null;

// ============================================================
// 初期化
// ============================================================
function initApp() {
  // Firebase設定チェック
  if (firebaseConfig.apiKey === 'YOUR_API_KEY') {
    showConfigError();
    return;
  }

  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  } catch (e) {
    showConfigError();
    return;
  }

  // 都道府県セレクトを全箇所に設定
  ['filter-prefecture', 'f-prefecture', 'e-prefecture'].forEach(populatePrefectures);

  // 今日の日付をデフォルト設定
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('f-date').value = today;

  // スター評価を初期化
  initStarRating('f-star-input', 'f-rating', 'f-rating-label', 3);
  initStarRating('e-star-input', 'e-rating', 'e-rating-label', 3);

  // イベントリスナー設定（写真コントローラーも初期化される）
  setupEventListeners();

  // Firestoreリアルタイムリスナー開始
  setupRealtimeListener();
}

function showConfigError() {
  document.getElementById('ramen-list').innerHTML = `
    <div class="empty-state" style="padding:40px 20px;">
      <div class="empty-icon">⚙️</div>
      <p class="empty-title">Firebase設定が必要です</p>
      <p class="empty-sub" style="max-width:280px;line-height:1.6;margin-top:8px;">
        <code>app.js</code> の先頭にある<br>
        <strong>firebaseConfig</strong> を<br>
        Firebaseコンソールの値に書き換えてください
      </p>
    </div>
  `;
}

// ============================================================
// イベントリスナー設定
// ============================================================
function setupEventListeners() {
  // タブ切り替え
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // 検索ボタン
  document.getElementById('search-btn').addEventListener('click', applyFilter);
  document.getElementById('reset-btn').addEventListener('click', resetFilter);
  // Enterキーで検索
  document.getElementById('filter-city').addEventListener('keydown', e => {
    if (e.key === 'Enter') applyFilter();
  });

  // 新規投稿フォーム
  document.getElementById('ramen-form').addEventListener('submit', handleFormSubmit);

  // 編集フォーム
  document.getElementById('edit-form').addEventListener('submit', handleEditSubmit);

  // モーダルを閉じるボタン
  document.getElementById('modal-close-btn').addEventListener('click', closeEditModal);
  document.getElementById('modal-cancel-btn').addEventListener('click', closeEditModal);

  // モーダル外クリックで閉じる
  document.getElementById('edit-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('edit-modal')) closeEditModal();
  });

  // 写真入力セットアップ
  newPhotoController = setupPhotoInput(
    'f-photo', 'f-photo-placeholder', 'f-photo-preview-wrap', 'f-photo-preview', 'f-photo-remove',
    url => { newFormPhotoUrl = url; }
  );
  editPhotoController = setupPhotoInput(
    'e-photo', 'e-photo-placeholder', 'e-photo-preview-wrap', 'e-photo-preview', 'e-photo-remove',
    url => { editFormPhotoUrl = url; }
  );

  // カードのアクションボタン（イベント委譲）
  document.getElementById('ramen-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'edit') openEditModal(id);
    if (action === 'delete') deleteRecord(id);
  });

  // Escキーでモーダルを閉じる
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeEditModal();
  });
}

// ============================================================
// Firestoreリアルタイムリスナー
// ============================================================
function setupRealtimeListener() {
  const q = query(collection(db, COLLECTION), orderBy('createdAt', 'desc'));

  unsubscribe = onSnapshot(q, snapshot => {
    allRecords = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    applyFilter();
  }, error => {
    console.error('Firestoreエラー:', error);
    let msg = 'データの読み込みに失敗しました。';
    if (error.code === 'permission-denied') {
      msg = 'Firestoreのセキュリティルールを確認してください。';
    }
    showToast(msg, 'error');
    document.getElementById('ramen-list').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p class="empty-title">接続エラー</p>
        <p class="empty-sub">${msg}</p>
      </div>
    `;
  });
}

// ============================================================
// 一覧レンダリング
// ============================================================
function renderList(records) {
  const listEl = document.getElementById('ramen-list');
  const infoEl = document.getElementById('records-info');

  if (records.length === 0) {
    infoEl.textContent = '';
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🍜</div>
        <p class="empty-title">記録がまだありません</p>
        <p class="empty-sub">「新規投稿」からラーメンを記録してみましょう！</p>
      </div>
    `;
    return;
  }

  infoEl.textContent = `${records.length}件の記録`;
  listEl.innerHTML = records.map(renderCard).join('');
}

function renderCard(record) {
  const stars = Array.from({ length: 5 }, (_, i) =>
    `<span class="star-display ${i + 1 <= (record.rating || 0) ? 'filled' : 'empty'}">★</span>`
  ).join('');

  // 写真サムネイル（data:image/... のみ許可してXSSを防止）
  const safeSrc = record.photoDataUrl && /^data:image\/(jpeg|png|gif|webp)/.test(record.photoDataUrl)
    ? record.photoDataUrl : null;
  const photoHtml = safeSrc
    ? `<div class="card-photo"><img src="${safeSrc}" alt="${esc(record.shopName || '')}のラーメン写真" loading="lazy"></div>`
    : '';

  const menus = (record.menus || []).filter(m => m && m.name);
  const menuHtml = menus.length > 0
    ? `<div class="card-menus">${menus.map(m =>
        `<span class="menu-chip">${esc(m.name)}${m.price ? ` ¥${Number(m.price).toLocaleString()}` : ''}</span>`
      ).join('')}</div>`
    : '';

  const linksHtml = buildLinksHtml(record.links);

  const shopParts = [];
  if (record.businessHours) shopParts.push(`⏰ ${esc(record.businessHours)}`);
  if (record.holidays) shopParts.push(`🚫 定休: ${esc(record.holidays)}`);
  const shopInfoHtml = shopParts.length
    ? `<div class="card-shop-info">${shopParts.map(p => `<span>${p}</span>`).join('')}</div>`
    : '';

  const id = esc(record.id);

  return `
    <div class="ramen-card">
      ${photoHtml}
      <div class="card-header">
        <div class="card-title-row">
          <h3 class="card-shop-name">${esc(record.shopName || '')}</h3>
          ${record.wantToReturn ? '<span class="return-badge">また行きたい！</span>' : ''}
        </div>
        <div class="card-meta">
          <span>📅 ${formatDate(record.date)}${record.time ? ` ${esc(record.time)}` : ''}</span>
          <span>📍 ${esc(record.prefecture || '')} ${esc(record.city || '')}</span>
        </div>
      </div>
      <div class="card-body">
        <div class="card-rating-row">
          <div class="card-stars">${stars}</div>
          ${record.ramenType ? `<span class="ramen-type-badge">${esc(record.ramenType)}</span>` : ''}
        </div>
        ${menuHtml}
        ${record.notes ? `<p class="card-notes">${esc(record.notes)}</p>` : ''}
        ${shopInfoHtml}
        ${linksHtml}
      </div>
      <div class="card-actions">
        <button class="btn-outline-sm" data-action="edit" data-id="${id}">✏️ 編集</button>
        <button class="btn-danger-sm" data-action="delete" data-id="${id}">🗑️ 削除</button>
      </div>
    </div>
  `;
}

function buildLinksHtml(links) {
  if (!links) return '';
  const urls = links.split('\n').map(l => l.trim()).filter(l => /^https?:\/\//i.test(l));
  if (!urls.length) return '';

  const items = urls.map(url => {
    let label = '🔗 リンク';
    if (/google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(url)) label = '🗺️ Googleマップ';
    else if (/instagram\.com/i.test(url)) label = '📸 Instagram';
    else if (/tabelog\.com/i.test(url)) label = '🍴 食べログ';
    else if (/twitter\.com|x\.com/i.test(url)) label = '𝕏 Twitter';
    else if (/facebook\.com/i.test(url)) label = '👤 Facebook';
    return `<a href="${encodeURI(url)}" target="_blank" rel="noopener noreferrer" class="link-chip">${label}</a>`;
  });

  return `<div class="card-links">${items.join('')}</div>`;
}

// ============================================================
// 検索・フィルター
// ============================================================
function applyFilter() {
  const prefecture = document.getElementById('filter-prefecture').value;
  const city = document.getElementById('filter-city').value.trim().toLowerCase();

  let filtered = allRecords;
  if (prefecture) filtered = filtered.filter(r => r.prefecture === prefecture);
  if (city) filtered = filtered.filter(r => (r.city || '').toLowerCase().includes(city));

  renderList(filtered);
}

function resetFilter() {
  document.getElementById('filter-prefecture').value = '';
  document.getElementById('filter-city').value = '';
  renderList(allRecords);
}

// ============================================================
// タブ切り替え
// ============================================================
function switchTab(tab) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });
  document.getElementById(`tab-${tab}`).classList.add('active');
  const activeBtn = document.querySelector(`[data-tab="${tab}"]`);
  activeBtn.classList.add('active');
  activeBtn.setAttribute('aria-selected', 'true');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ============================================================
// フォーム送信（新規投稿）
// ============================================================
async function handleFormSubmit(e) {
  e.preventDefault();
  if (!validateForm('f')) return;

  const submitBtn = e.target.querySelector('[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = '保存中...';

  try {
    await addDoc(collection(db, COLLECTION), {
      ...getFormData('f'),
      photoDataUrl: newFormPhotoUrl,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    showToast('記録を保存しました！🍜', 'success');
    e.target.reset();

    // 今日の日付を再設定
    document.getElementById('f-date').value = new Date().toISOString().split('T')[0];
    // スター評価をリセット
    const starEl = document.getElementById('f-star-input');
    if (starEl._setRating) starEl._setRating(3);
    // 写真をリセット
    newFormPhotoUrl = null;
    if (newPhotoController) newPhotoController.clear();

    switchTab('list');
  } catch (err) {
    console.error('保存エラー:', err);
    showToast('保存に失敗しました。Firebase設定を確認してください。', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '💾 記録を保存する';
  }
}

// ============================================================
// フォーム送信（編集）
// ============================================================
async function handleEditSubmit(e) {
  e.preventDefault();
  if (!editingDocId || !validateForm('e')) return;

  const submitBtn = e.target.querySelector('[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = '更新中...';

  try {
    await updateDoc(doc(db, COLLECTION, editingDocId), {
      ...getFormData('e'),
      photoDataUrl: editFormPhotoUrl,
      updatedAt: serverTimestamp(),
    });

    showToast('記録を更新しました！', 'success');
    closeEditModal();
  } catch (err) {
    console.error('更新エラー:', err);
    showToast('更新に失敗しました。', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '💾 更新する';
  }
}

// ============================================================
// バリデーション
// ============================================================
function validateForm(p) {
  const checks = [
    [document.getElementById(`${p}-date`).value, '日付を入力してください'],
    [document.getElementById(`${p}-prefecture`).value, '都道府県を選択してください'],
    [document.getElementById(`${p}-city`).value.trim(), '市町村を入力してください'],
    [document.getElementById(`${p}-shop-name`).value.trim(), '店名を入力してください'],
  ];
  for (const [val, msg] of checks) {
    if (!val) { showToast(msg, 'error'); return false; }
  }
  return true;
}

// ============================================================
// フォームデータ取得
// ============================================================
function getFormData(p) {
  const formEl = document.getElementById(p === 'f' ? 'ramen-form' : 'edit-form');
  const nameEls = formEl.querySelectorAll('.menu-name');
  const priceEls = formEl.querySelectorAll('.menu-price');

  const menus = Array.from(nameEls).map((el, i) => ({
    name: el.value.trim(),
    price: priceEls[i].value !== '' ? parseInt(priceEls[i].value, 10) : null,
  }));

  return {
    date: document.getElementById(`${p}-date`).value,
    time: document.getElementById(`${p}-time`).value,
    prefecture: document.getElementById(`${p}-prefecture`).value,
    city: document.getElementById(`${p}-city`).value.trim(),
    shopName: document.getElementById(`${p}-shop-name`).value.trim(),
    ramenType: document.getElementById(`${p}-ramen-type`).value,
    menus,
    businessHours: document.getElementById(`${p}-hours`).value.trim(),
    holidays: document.getElementById(`${p}-holidays`).value.trim(),
    links: document.getElementById(`${p}-links`).value.trim(),
    notes: document.getElementById(`${p}-notes`).value.trim(),
    rating: parseInt(document.getElementById(`${p}-rating`).value, 10) || 3,
    wantToReturn: document.getElementById(`${p}-want-to-return`).checked,
  };
}

// ============================================================
// 編集モーダル
// ============================================================
function openEditModal(id) {
  const record = allRecords.find(r => r.id === id);
  if (!record) return;

  editingDocId = id;

  document.getElementById('e-date').value = record.date || '';
  document.getElementById('e-time').value = record.time || '';
  document.getElementById('e-prefecture').value = record.prefecture || '';
  document.getElementById('e-city').value = record.city || '';
  document.getElementById('e-shop-name').value = record.shopName || '';
  document.getElementById('e-ramen-type').value = record.ramenType || '';
  document.getElementById('e-hours').value = record.businessHours || '';
  document.getElementById('e-holidays').value = record.holidays || '';
  document.getElementById('e-links').value = record.links || '';
  document.getElementById('e-notes').value = record.notes || '';
  document.getElementById('e-want-to-return').checked = record.wantToReturn || false;

  // メニューを設定
  const editForm = document.getElementById('edit-form');
  const nameEls = editForm.querySelectorAll('.menu-name');
  const priceEls = editForm.querySelectorAll('.menu-price');
  const menus = record.menus || [];
  nameEls.forEach((el, i) => { el.value = menus[i]?.name || ''; });
  priceEls.forEach((el, i) => { el.value = menus[i]?.price ?? ''; });

  // スター評価を設定
  const starEl = document.getElementById('e-star-input');
  if (starEl._setRating) starEl._setRating(record.rating || 3);

  // 写真を設定
  editFormPhotoUrl = record.photoDataUrl || null;
  if (editPhotoController) editPhotoController.set(editFormPhotoUrl);

  // モーダルを表示
  document.getElementById('edit-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // モーダルを先頭にスクロール
  document.querySelector('.modal-body').scrollTop = 0;
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.add('hidden');
  document.body.style.overflow = '';
  editingDocId = null;
  editFormPhotoUrl = null;
}

// ============================================================
// 削除
// ============================================================
async function deleteRecord(id) {
  const record = allRecords.find(r => r.id === id);
  const name = record?.shopName || '記録';

  if (!confirm(`「${name}」の記録を削除しますか？\nこの操作は元に戻せません。`)) return;

  try {
    await deleteDoc(doc(db, COLLECTION, id));
    showToast('削除しました', 'success');
  } catch (err) {
    console.error('削除エラー:', err);
    showToast('削除に失敗しました。', 'error');
  }
}

// ============================================================
// スター評価ウィジェット
// ============================================================
function initStarRating(containerId, ratingInputId, labelId, initial) {
  const container = document.getElementById(containerId);
  let current = initial;

  // 星ボタンを生成（一度だけ）
  container.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const star = document.createElement('span');
    star.className = 'star-btn';
    star.textContent = '★';
    star.dataset.val = i;
    container.appendChild(star);
  }

  function render(hover = null) {
    container.querySelectorAll('.star-btn').forEach((s, idx) => {
      const val = idx + 1;
      const isActive = val <= current;
      const isHover = hover !== null && val <= hover && val > current;
      s.classList.toggle('active', isActive);
      s.classList.toggle('hover', isHover);
    });
  }

  function updateLabel(val) {
    document.getElementById(ratingInputId).value = val;
    document.getElementById(labelId).textContent =
      `${'★'.repeat(val)}（${RATING_LABELS[val]}）`;
  }

  container.addEventListener('click', e => {
    const star = e.target.closest('.star-btn');
    if (!star) return;
    current = parseInt(star.dataset.val, 10);
    updateLabel(current);
    render();
  });

  container.addEventListener('mouseover', e => {
    const star = e.target.closest('.star-btn');
    if (!star) return;
    render(parseInt(star.dataset.val, 10));
  });

  container.addEventListener('mouseleave', () => render());

  // タッチデバイスはhoverをスキップ
  container.addEventListener('touchstart', () => {}, { passive: true });

  // 外部から評価をセットするためのメソッド
  container._setRating = val => {
    current = val;
    updateLabel(val);
    render();
  };

  render();
  updateLabel(current);
}

// ============================================================
// 都道府県セレクト
// ============================================================
function populatePrefectures(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  PREFECTURES.forEach(pref => {
    const opt = document.createElement('option');
    opt.value = pref;
    opt.textContent = pref;
    sel.appendChild(opt);
  });
}

// ============================================================
// 写真圧縮・アップロード UI
// ============================================================

// Canvas APIで最大800px・JPEG70%に圧縮してData URLを返す
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('ファイル読み込み失敗'));
    reader.onload = e => {
      const img = new Image();
      img.onerror = () => reject(new Error('画像解析失敗'));
      img.onload = () => {
        const MAX = 800;
        let w = img.width;
        let h = img.height;
        if (w > MAX || h > MAX) {
          if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// 写真入力UIをセットアップし、コントローラーオブジェクトを返す
function setupPhotoInput(inputId, placeholderId, previewWrapId, previewImgId, removeBtnId, onPhotoChange) {
  const input       = document.getElementById(inputId);
  const placeholder = document.getElementById(placeholderId);
  const previewWrap = document.getElementById(previewWrapId);
  const previewImg  = document.getElementById(previewImgId);
  const removeBtn   = document.getElementById(removeBtnId);

  function showPreview(dataUrl) {
    previewImg.src = dataUrl;
    previewWrap.classList.remove('hidden');
    placeholder.classList.add('hidden');
  }

  function clearPreview() {
    previewImg.src = '';
    previewWrap.classList.add('hidden');
    placeholder.classList.remove('hidden');
    input.value = '';
  }

  input.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    input.value = '';
    try {
      const dataUrl = await compressImage(file);
      showPreview(dataUrl);
      onPhotoChange(dataUrl);
    } catch (err) {
      console.error('画像圧縮エラー:', err);
      showToast('画像の処理に失敗しました', 'error');
      clearPreview();
      onPhotoChange(null);
    }
  });

  removeBtn.addEventListener('click', () => {
    clearPreview();
    onPhotoChange(null);
  });

  return {
    set:   (dataUrl) => { if (dataUrl) showPreview(dataUrl); else clearPreview(); },
    clear: ()        => clearPreview(),
  };
}

// ============================================================
// ユーティリティ
// ============================================================
function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const [y, m, d] = dateStr.split('-');
    return `${y}年${m}月${d}日`;
  } catch {
    return dateStr;
  }
}

// HTML特殊文字エスケープ（XSS防止）
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let toastTimer = null;

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  if (toastTimer) clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast toast-${type}`;
  toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3200);
}

// ============================================================
// アプリ起動
// ============================================================
initApp();
