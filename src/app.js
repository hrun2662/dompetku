/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Mengimpor file CSS global agar Tailwind diproses oleh Vite
import './index.css';

// Mengimpor jsPDF untuk cetak laporan keuangan
import { jsPDF } from 'jspdf';

// Mengimpor library motion untuk animasi yang halus dan interaktif
import { animate } from 'motion';

// Mengimpor modul Firebase dari inisialisasi lokal
import { auth, db, googleProvider } from './firebase.js';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { 
  doc, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  serverTimestamp, 
  getDocFromServer 
} from 'firebase/firestore';

// ==========================================
// TELEMETRI & PENANGANAN ERROR FIRESTORE
// ==========================================
const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
};

/**
 * Penanganan Error standar Firebase sesuai spesifikasi skill
 */
function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser ? auth.currentUser.uid : null,
      email: auth.currentUser ? auth.currentUser.email : null,
      emailVerified: auth.currentUser ? auth.currentUser.emailVerified : null,
      isAnonymous: auth.currentUser ? auth.currentUser.isAnonymous : null,
    },
    operationType,
    path
  };
  console.error('Firestore Error Payload: ', JSON.stringify(errInfo));
  showToast('Gagal menyinkronkan data dengan cloud. Pastikan koneksi internet stabil dan rules database mengizinkan.', 'danger');
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Validasi koneksi awal ke Firestore saat program boot
 */
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn("Client sedang luring. Menggunakan database lokal cache jika tersedia.");
    }
  }
}

// ==========================================
// STATE APLIKASI UTAMA
// ==========================================
let transactions = [];
let editingId = null;
let queryUnsubscribe = null;
let isGuestMode = false;

// Kategori transaksi yang tersedia berdasarkan tipe
const CATEGORIES = {
  income: [
    'Gaji & Bonus',
    'Profit Trading & Investasi',
    'Penjualan & Usaha',
    'Hasil Freelance',
    'Cashback & Hadiah',
    'Dividen & Bunga Bank',
    'Pendapatan Lainnya'
  ],
  expense: [
    'Makanan & Minuman',
    'Transportasi & BBM',
    'Belanja Kebutuhan',
    'Tagihan & Listrik',
    'Internet & Pulsa',
    'Hiburan & Rekreasi',
    'Pendidikan & Buku',
    'Kesehatan & Medis',
    'Tabungan & Investasi',
    'Cicilan & Hutang',
    'Pengeluaran Lainnya'
  ]
};

// Icon kelas FontAwesome untuk masing-masing kategori
const CATEGORY_ICONS = {
  'Gaji & Bonus': 'fa-solid fa-briefcase text-emerald-500 bg-emerald-50',
  'Profit Trading & Investasi': 'fa-solid fa-chart-line text-blue-500 bg-blue-50',
  'Penjualan & Usaha': 'fa-solid fa-store text-indigo-500 bg-indigo-50',
  'Hasil Freelance': 'fa-solid fa-laptop text-teal-500 bg-teal-50',
  'Cashback & Hadiah': 'fa-solid fa-gift text-pink-500 bg-pink-50',
  'Dividen & Bunga Bank': 'fa-solid fa-coins text-amber-500 bg-amber-50',
  'Pendapatan Lainnya': 'fa-solid fa-folder-plus text-slate-500 bg-slate-50',
  
  'Makanan & Minuman': 'fa-solid fa-utensils text-amber-500 bg-amber-50',
  'Transportasi & BBM': 'fa-solid fa-car text-cyan-500 bg-cyan-50',
  'Belanja Kebutuhan': 'fa-solid fa-basket-shopping text-emerald-600 bg-emerald-50',
  'Tagihan & Listrik': 'fa-solid fa-bolt text-yellow-550 bg-yellow-50',
  'Internet & Pulsa': 'fa-solid fa-wifi text-sky-500 bg-sky-50',
  'Hiburan & Rekreasi': 'fa-solid fa-gamepad text-purple-500 bg-purple-50',
  'Pendidikan & Buku': 'fa-solid fa-book text-indigo-600 bg-indigo-50',
  'Kesehatan & Medis': 'fa-solid fa-house-medical text-rose-500 bg-rose-50',
  'Tabungan & Investasi': 'fa-solid fa-piggy-bank text-emerald-500 bg-emerald-50',
  'Cicilan & Hutang': 'fa-solid fa-file-invoice-dollar text-red-500 bg-red-50',
  'Pengeluaran Lainnya': 'fa-solid fa-circle-nodes text-slate-500 bg-slate-50'
};

// Elemen DOM utama
let formTransaction;
let inputId;
let radioIncome;
let radioExpense;
let selectCategory;
let inputAmount;
let inputDate;
let inputDescription;
let submitBtn;
let cancelBtn;
let textTotalBalance;
let textTotalIncome;
let textTotalExpense;
let listTransactions;
let searchInput;
let filterAll;
let filterIncome;
let filterExpense;
let currentFilter = 'all'; // Default filter tipe

// Elemen DOM Autentikasi
let loadingScreen;
let authScreen;
let appScreen;
let loginBtn;
let logoutBtn;
let userAvatar;
let userName;

// ==========================================
// FORMATTER & HELPER (FORMAT&DATES)
// ==========================================

function formatRupiah(amount) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

function formatTanggal(dateString) {
  if (!dateString) return '';
  const parts = dateString.split('-');
  const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(dateObj);
}

// ==========================================
// LOGIKA UTAMA & KALKULASI (CALCULATIONS)
// ==========================================

function updateDashboard() {
  let totalIncome = 0;
  let totalExpense = 0;

  transactions.forEach(t => {
    const val = parseFloat(t.amount) || 0;
    if (t.type === 'income') {
      totalIncome += val;
    } else if (t.type === 'expense') {
      totalExpense += val;
    }
  });

  const totalBalance = totalIncome - totalExpense;

  textTotalIncome.textContent = formatRupiah(totalIncome);
  textTotalExpense.textContent = formatRupiah(totalExpense);
  textTotalBalance.textContent = formatRupiah(totalBalance);

  const balanceCard = document.getElementById('balance-card');
  const balanceIcon = document.getElementById('balance-icon');
  
  if (totalBalance > 0) {
    if (balanceCard) {
      balanceCard.className = 'relative overflow-hidden bg-gradient-to-br from-indigo-950 via-slate-900 to-emerald-950 text-white p-6 rounded-3xl shadow-lg shadow-indigo-950/25 border-0 flex flex-col justify-between min-h-[160px] transition-all duration-300 hover:scale-[1.01] hover:shadow-xl sm:col-span-2 lg:col-span-1';
    }
    if (balanceIcon) {
      balanceIcon.className = 'fa-solid fa-wallet text-sm text-emerald-400';
    }
  } else if (totalBalance < 0) {
    if (balanceCard) {
      balanceCard.className = 'relative overflow-hidden bg-gradient-to-br from-indigo-950 via-slate-900 to-rose-950 text-white p-6 rounded-3xl shadow-lg shadow-rose-950/25 border-0 flex flex-col justify-between min-h-[160px] transition-all duration-300 hover:scale-[1.01] hover:shadow-xl sm:col-span-2 lg:col-span-1';
    }
    if (balanceIcon) {
      balanceIcon.className = 'fa-solid fa-wallet text-sm text-rose-450';
    }
  } else {
    if (balanceCard) {
      balanceCard.className = 'relative overflow-hidden bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-900 text-white p-6 rounded-3xl shadow-lg shadow-indigo-950/20 border-0 flex flex-col justify-between min-h-[160px] transition-all duration-300 hover:scale-[1.01] hover:shadow-xl sm:col-span-2 lg:col-span-1';
    }
    if (balanceIcon) {
      balanceIcon.className = 'fa-solid fa-wallet text-sm text-indigo-300';
    }
  }

  // Update category distribution statistics
  updateCategoryStats();
}

function updateCategoryStats() {
  const container = document.getElementById('category-stats-card');
  const barsContainer = document.getElementById('category-bars');
  if (!container || !barsContainer) return;

  // Filter only expenses
  const expenses = transactions.filter(t => t.type === 'expense');
  if (expenses.length === 0) {
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');

  const totals = {};
  let overallExpense = 0;

  expenses.forEach(t => {
    const amt = parseFloat(t.amount) || 0;
    totals[t.category] = (totals[t.category] || 0) + amt;
    overallExpense += amt;
  });

  // Convert to array and sort descending
  const sortedStats = Object.keys(totals).map(cat => ({
    category: cat,
    amount: totals[cat],
    percentage: overallExpense > 0 ? (totals[cat] / overallExpense) * 100 : 0
  })).sort((a, b) => b.amount - a.amount);

  barsContainer.innerHTML = '';

  // Tailwind colors for progress bar fills based on category
  const barColors = {
    'Makanan & Minuman': 'bg-amber-500',
    'Transportasi & BBM': 'bg-cyan-500',
    'Belanja Kebutuhan': 'bg-emerald-600',
    'Tagihan & Listrik': 'bg-yellow-500',
    'Internet & Pulsa': 'bg-sky-500',
    'Hiburan & Rekreasi': 'bg-purple-500',
    'Pendidikan & Buku': 'bg-indigo-600',
    'Kesehatan & Medis': 'bg-rose-500',
    'Tabungan & Investasi': 'bg-teal-500',
    'Cicilan & Hutang': 'bg-red-500',
    'Pengeluaran Lainnya': 'bg-slate-500'
  };

  sortedStats.forEach(stat => {
    const pct = stat.percentage.toFixed(1);
    const colorClass = barColors[stat.category] || 'bg-slate-500';
    const formattedAmt = formatRupiah(stat.amount);

    const barItem = document.createElement('div');
    barItem.className = 'space-y-1.5 focus:outline-none';
    barItem.innerHTML = `
      <div class="flex justify-between items-center text-xs">
        <div class="flex items-center gap-2">
          <!-- Small indicator dot -->
          <span class="w-2.5 h-2.5 rounded-full ${colorClass}"></span>
          <span class="font-bold text-slate-700">${stat.category}</span>
          <span class="text-[10px] text-slate-400 font-semibold">(${pct}%)</span>
        </div>
        <span class="mono-font font-bold text-slate-800">${formattedAmt}</span>
      </div>
      <div class="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
        <div class="${colorClass} h-full rounded-full transition-all duration-500" style="width: ${pct}%"></div>
      </div>
    `;
    barsContainer.appendChild(barItem);
  });
}

function updateCategoryDropdown() {
  const currentType = radioIncome.checked ? 'income' : 'expense';
  const categories = CATEGORIES[currentType];
  const previousValue = selectCategory.value;
  
  selectCategory.innerHTML = '';
  
  const placeholderOpt = document.createElement('option');
  placeholderOpt.value = '';
  placeholderOpt.textContent = 'Pilih Kategori';
  placeholderOpt.disabled = true;
  placeholderOpt.selected = true;
  selectCategory.appendChild(placeholderOpt);

  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    selectCategory.appendChild(opt);
  });

  if (categories.includes(previousValue)) {
    selectCategory.value = previousValue;
  }
}

// ==========================================
// RENDERING RIWAYAT TRANSAKSI (READ)
// ==========================================

function renderTransactions() {
  const searchQuery = searchInput.value.toLowerCase().trim();
  
  let filtered = transactions.filter(t => {
    if (currentFilter === 'income' && t.type !== 'income') return false;
    if (currentFilter === 'expense' && t.type !== 'expense') return false;
    
    if (searchQuery) {
      const catMatch = t.category.toLowerCase().includes(searchQuery);
      const descMatch = (t.description || '').toLowerCase().includes(searchQuery);
      return catMatch || descMatch;
    }
    return true;
  });

  // Urutkan transaksi dari tanggal terbaru (descending)
  // Jika tanggal sama, urutkan berdasarkan updatedAt/createdAt
  filtered.sort((a, b) => {
    if (b.date !== a.date) {
      return b.date.localeCompare(a.date);
    }
    return (b.id || '').localeCompare(a.id || '');
  });

  listTransactions.innerHTML = '';

  if (filtered.length === 0) {
    listTransactions.innerHTML = `
      <div class="flex flex-col items-center justify-center py-10 px-4 text-center text-slate-400 animate-fade-in">
        <div class="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-3">
          <i class="fa-solid fa-receipt text-2xl text-slate-300"></i>
        </div>
        <p class="font-medium text-slate-500 text-sm">Belum ada transaksi</p>
        <p class="text-xs text-slate-450 mt-1">${searchQuery || currentFilter !== 'all' ? 'Coba ubah kriteria pencarian atau filter Anda.' : 'Silakan tambahkan pemasukan atau pengeluaran baru Anda di atas.'}</p>
      </div>
    `;
    return;
  }

  filtered.forEach((t, idx) => {
    const item = document.createElement('div');
    item.className = 'group flex flex-col sm:flex-row sm:items-center justify-between p-4.5 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50/60 hover:shadow-md hover:border-slate-200/65 transition-all duration-300 hover:-translate-y-[0.5px] gap-3';
    item.id = `trx-${t.id}`;

    const rawIconClass = CATEGORY_ICONS[t.category] || 'fa-solid fa-circle-nodes text-slate-500 bg-slate-50';
    const specificIconClass = rawIconClass.split(' ').slice(0, 2).join(' ');
    
    const isIncome = t.type === 'income';
    const sign = isIncome ? '+' : '-';
    const amountColor = isIncome ? 'text-emerald-600' : 'text-rose-600';
    const bgIcon = isIncome ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-rose-50 text-rose-600 border border-rose-100';

    item.innerHTML = `
      <div class="flex items-center gap-3.5 min-w-0 flex-1">
        <!-- Bulat Icon with soft type reflective color background -->
        <div class="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${bgIcon} shadow-xs transition-transform duration-300 group-hover:scale-105">
          <i class="${specificIconClass} text-sm"></i>
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="brand-font font-bold text-slate-800 text-sm md:text-base leading-tight">${t.category}</span>
            <span class="mono-font text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${isIncome ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}">
              ${isIncome ? 'Debet' : 'Kredit'}
            </span>
          </div>
          <!-- Tanggal & Catatan: font lebih kecil & warna redup -->
          <div class="flex items-center gap-2 mt-1 flex-wrap">
            <p class="text-xs text-slate-400 font-semibold">${formatTanggal(t.date)}</p>
            ${t.description ? `
              <span class="hidden sm:inline-block w-1 h-1 bg-slate-300 rounded-full"></span>
              <p class="text-xs text-slate-500 font-medium truncate max-w-[200px] sm:max-w-[150px] md:max-w-[220px] lg:max-w-[260px] xl:max-w-[340px]" title="${t.description}">${t.description}</p>
            ` : ''}
          </div>
          <!-- Show description inline on mobile layout if present -->
          ${t.description ? `
            <p class="block sm:hidden text-xs text-slate-500 font-medium mt-1 truncate max-w-[250px]" title="${t.description}">${t.description}</p>
          ` : ''}
        </div>
      </div>
      
      <!-- Right Side: Money digit & controls -->
      <div class="flex items-center justify-between sm:justify-end gap-3.5 border-t border-slate-100/60 sm:border-t-0 pt-2.5 sm:pt-0 mt-1 sm:mt-0">
        <span class="mono-font font-bold text-sm sm:text-base md:text-[17px] ${amountColor} tracking-tight order-1 sm:order-none">
          ${sign}${formatRupiah(t.amount)}
        </span>
        
        <!-- Action buttons: appears on hover dynamically in desktop, always ready on mobile -->
        <div class="flex items-center gap-1 order-2 sm:order-none opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <button onclick="editTransaction('${t.id}')" class="p-2 text-slate-400 hover:text-indigo-650 hover:bg-slate-100 rounded-xl transition-all duration-200 cursor-pointer" title="Ubah Mutasi">
            <i class="fa-regular fa-pen-to-square text-xs md:text-sm"></i>
          </button>
          <button onclick="deleteTransaction('${t.id}')" class="p-2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all duration-200 cursor-pointer" title="Hapus Mutasi">
            <i class="fa-regular fa-trash-can text-xs md:text-sm"></i>
          </button>
        </div>
      </div>
    `;

    listTransactions.appendChild(item);

    // Animasi masuk yang halus dengan delay berjalan (staggering) menggunakan library motion
    animate(
      item,
      { opacity: [0, 1], y: [16, 0] },
      { 
        duration: 0.38, 
        delay: Math.min(idx * 0.035, 0.45), 
        easing: 'ease-out' 
      }
    );
  });
}

// ==========================================
// CRUD OPERATIONS ENGINES (UBAH/HAPUS/SIMPAN)
// ==========================================

function resetForm() {
  editingId = null;
  inputId.value = '';
  formTransaction.reset();
  
  radioExpense.checked = true;
  updateCategoryDropdown();
  
  submitBtn.innerHTML = '<i class="fa-solid fa-plus mr-2"></i>Simpan Transaksi';
  cancelBtn.classList.add('hidden');
  
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  inputDate.value = `${year}-${month}-${day}`;
}

async function handleFormSubmit(e) {
  e.preventDefault();

  if (!auth.currentUser && !isGuestMode) {
    showToast('Oops! Sesi Anda berakhir. Silakan hubungkan kembali akun Google Anda.', 'warning');
    return;
  }

  const typeValue = radioIncome.checked ? 'income' : 'expense';
  const categoryValue = selectCategory.value;
  const amountValue = parseFloat(inputAmount.value);
  const dateValue = inputDate.value;
  const descriptionValue = inputDescription.value.trim();

  // Validasi input klien
  if (!typeValue) {
    showToast('Pilih tipe transaksi terlebih dahulu!', 'warning');
    return;
  }
  if (!categoryValue) {
    showToast('Silakan pilih salah satu kategori!', 'warning');
    return;
  }
  if (isNaN(amountValue) || amountValue <= 0) {
    showToast('Nominal uang harus angka valid dan lebih dari Rp 0!', 'warning');
    return;
  }
  if (!dateValue) {
    showToast('Silakan isi tanggal transaksi!', 'warning');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Menyimpan...';

  if (isGuestMode) {
    if (editingId) {
      // Mode Update (Guest)
      const idx = transactions.findIndex(t => t.id === editingId);
      if (idx !== -1) {
        transactions[idx] = {
          ...transactions[idx],
          type: typeValue,
          category: categoryValue,
          amount: amountValue,
          date: dateValue,
          description: descriptionValue,
          updatedAt: new Date().toISOString()
        };
      }
      localStorage.setItem('dompetku_guest_transactions', JSON.stringify(transactions));
      showToast('Transaksi (Tamu) berhasil diperbarui secara lokal!', 'success');
      resetForm();
      const mobileTabDashboard = document.getElementById('mobile-tab-dashboard');
      if (mobileTabDashboard && window.innerWidth < 768) {
        mobileTabDashboard.click();
      }
      updateDashboard();
      renderTransactions();
    } else {
      // Mode Create (Guest)
      const customId = `trx-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const payload = {
        id: customId,
        userId: 'guest',
        type: typeValue,
        category: categoryValue,
        amount: amountValue,
        date: dateValue,
        description: descriptionValue,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      transactions.unshift(payload);
      localStorage.setItem('dompetku_guest_transactions', JSON.stringify(transactions));
      showToast('Catatan transaksi (Tamu) berhasil disimpan secara lokal!', 'success');
      resetForm();
      const mobileTabDashboard = document.getElementById('mobile-tab-dashboard');
      if (mobileTabDashboard && window.innerWidth < 768) {
        mobileTabDashboard.click();
      }
      updateDashboard();
      renderTransactions();
    }
    submitBtn.disabled = false;
    return;
  }

  if (editingId) {
    // Mode Update (Firebase)
    const docRef = doc(db, 'transactions', String(editingId));
    
    const payload = {
      type: typeValue,
      category: categoryValue,
      amount: amountValue,
      date: dateValue,
      description: descriptionValue,
      updatedAt: serverTimestamp()
    };

    try {
      await updateDoc(docRef, payload);
      showToast('Transaksi berhasil diperbarui di Cloud Firestore!', 'success');
      resetForm();
      const mobileTabDashboard = document.getElementById('mobile-tab-dashboard');
      if (mobileTabDashboard && window.innerWidth < 768) {
        mobileTabDashboard.click();
      }
    } catch (error) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-check mr-2"></i>Perbarui Transaksi';
      handleFirestoreError(error, OperationType.UPDATE, `transactions/${editingId}`);
    }
  } else {
    // Mode Create (Firebase)
    const customId = `trx-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const docRef = doc(db, 'transactions', customId);

    const payload = {
      id: customId,
      userId: auth.currentUser.uid,
      type: typeValue,
      category: categoryValue,
      amount: amountValue,
      date: dateValue,
      description: descriptionValue,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    try {
      await setDoc(docRef, payload);
      showToast('Catatan transaksi berhasil disimpan ke Cloud Firestore!', 'success');
      resetForm();
      const mobileTabDashboard = document.getElementById('mobile-tab-dashboard');
      if (mobileTabDashboard && window.innerWidth < 768) {
        mobileTabDashboard.click();
      }
    } catch (error) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-plus mr-2"></i>Simpan Transaksi';
      handleFirestoreError(error, OperationType.CREATE, `transactions/${customId}`);
    }
  }

  submitBtn.disabled = false;
}

window.editTransaction = function(id) {
  const trx = transactions.find(t => t.id === String(id));
  if (!trx) return;

  editingId = String(id);
  inputId.value = trx.id;

  if (trx.type === 'income') {
    radioIncome.checked = true;
  } else {
    radioExpense.checked = true;
  }
  
  updateCategoryDropdown();
  selectCategory.value = trx.category;

  inputAmount.value = trx.amount;
  inputDate.value = trx.date;
  inputDescription.value = trx.description || '';

  submitBtn.innerHTML = '<i class="fa-solid fa-check mr-2"></i>Perbarui Transaksi';
  cancelBtn.classList.remove('hidden');

  const mobileTabForm = document.getElementById('mobile-tab-form');
  if (mobileTabForm && window.innerWidth < 768) {
    mobileTabForm.click();
  }
  
  setTimeout(() => {
    const formSec = document.getElementById('form-section');
    if (formSec) formSec.scrollIntoView({ behavior: 'smooth' });
  }, 100);
}

window.deleteTransaction = function(id) {
  const targetId = String(id);
  const trx = transactions.find(t => t.id === targetId);
  if (!trx) return;

  const confirmMsg = isGuestMode 
    ? `Apakah Anda yakin ingin menghapus transaksi "${trx.category}" senilai ${formatRupiah(trx.amount)} dari penyimpanan lokal browser?`
    : `Apakah Anda yakin ingin menghapus transaksi "${trx.category}" senilai ${formatRupiah(trx.amount)} dari Cloud Firestore?`;

  showCustomConfirm({
    title: 'Hapus Transaksi',
    message: confirmMsg,
    iconClass: 'fa-regular fa-trash-can text-lg',
    iconBgClass: 'bg-rose-50 text-rose-600 border border-rose-100',
    submitText: 'Hapus',
    submitBtnBgClass: 'bg-rose-600 hover:bg-rose-700 focus:ring-2 focus:ring-rose-500/30',
    onConfirm: async () => {
      if (editingId === targetId) {
        resetForm();
      }

      if (isGuestMode) {
        transactions = transactions.filter(t => t.id !== targetId);
        localStorage.setItem('dompetku_guest_transactions', JSON.stringify(transactions));
        showToast('Transaksi berhasil dihapus secara lokal!', 'success');
        updateDashboard();
        renderTransactions();
        return;
      }

      const docRef = doc(db, 'transactions', targetId);
      try {
        await deleteDoc(docRef);
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `transactions/${targetId}`);
      }
    }
  });
}

function downloadPDFSummary() {
  if (transactions.length === 0) {
    showToast('Tidak ada data transaksi untuk diekspor ke PDF!', 'warning');
    return;
  }

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const currentUser = auth.currentUser;
  const userNameVal = isGuestMode ? 'Mode Tamu DompetKu' : (currentUser ? (currentUser.displayName || 'Pengguna DompetKu') : 'Pengguna DompetKu');
  const userEmailVal = isGuestMode ? 'mode.tamu@dompetku.local' : (currentUser ? (currentUser.email || '-') : '-');
  const dateStr = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date());

  // Calculations
  let totalIncome = 0;
  let totalExpense = 0;
  transactions.forEach(t => {
    const amt = parseFloat(t.amount) || 0;
    if (t.type === 'income') {
      totalIncome += amt;
    } else if (t.type === 'expense') {
      totalExpense += amt;
    }
  });
  const balance = totalIncome - totalExpense;

  // Let's draw the header
  // Header background block (sleek dark slate banner)
  doc.setFillColor(15, 23, 42); // slate-900 / dark blue-grey
  doc.rect(0, 0, 210, 40, 'F');

  // Title
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('DompetKu', 15, 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(148, 163, 184); // slate-400
  doc.text('Laporan Ringkasan Keuangan Personal', 15, 24);

  // Status badge style block
  doc.setFillColor(16, 185, 129); // emerald-500
  doc.rect(15, 28, 32, 5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('VERIFIED DIGITAL REPORT', 17, 31.5);

  // User details pinned on report banner
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(226, 232, 240); // slate-200
  doc.text(`Unduh Oleh: ${userNameVal}`, 125, 16);
  doc.text(`Sesi Email: ${userEmailVal}`, 125, 22);
  doc.text(`Waktu Ekspor: ${dateStr}`, 125, 28);

  let y = 52;

  // 1. Section: Ringkasan Finansial
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text('1. Ringkasan Finansial', 15, y);
  
  // Underline
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.line(15, y + 2, 195, y + 2);
  y += 10;

  // Draw 3 boxes representing Saldo, Income, Expense
  // Total Saldo Card
  doc.setFillColor(248, 250, 252); // slate-50
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.roundedRect(15, y, 55, 24, 3, 3, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105); // slate-600
  doc.text('TOTAL SALDO', 20, y + 6);
  doc.setFontSize(11);
  doc.setTextColor(79, 70, 229); // indigo-600
  doc.text(formatRupiah(balance), 20, y + 16);

  // Total Pemasukan Card
  doc.setFillColor(240, 253, 250); // green-50
  doc.setDrawColor(209, 250, 229); // green-100
  doc.roundedRect(75, y, 55, 24, 3, 3, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(5, 150, 105); // green-600
  doc.text('TOTAL PEMASUKAN', 80, y + 6);
  doc.setFontSize(11);
  doc.setTextColor(5, 150, 105);
  doc.text(formatRupiah(totalIncome), 80, y + 16);

  // Total Pengeluaran Card
  doc.setFillColor(254, 242, 242); // red-50
  doc.setDrawColor(254, 226, 226); // red-100
  doc.roundedRect(135, y, 55, 24, 3, 3, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(220, 38, 38); // red-600
  doc.text('TOTAL PENGELUARAN', 140, y + 6);
  doc.setFontSize(11);
  doc.setTextColor(220, 38, 38);
  doc.text(formatRupiah(totalExpense), 140, y + 16);

  y += 35;

  // 2. Section: Distribusi Pengeluaran Kategori
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text('2. Dampak Kategori Pengeluaran', 15, y);
  doc.line(15, y + 2, 195, y + 2);
  y += 8;

  // Find expenses category breakdown
  const expenses = transactions.filter(t => t.type === 'expense');
  if (expenses.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('Belum ada catatan pengeluaran terekam.', 15, y);
    y += 10;
  } else {
    // Collect stats
    const catTotals = {};
    let sumExpense = 0;
    expenses.forEach(t => {
      const amt = parseFloat(t.amount) || 0;
      catTotals[t.category] = (catTotals[t.category] || 0) + amt;
      sumExpense += amt;
    });

    const sortedStats = Object.keys(catTotals).map(cat => ({
      category: cat,
      amount: catTotals[cat],
      percentage: sumExpense > 0 ? (catTotals[cat] / sumExpense) * 100 : 0
    })).sort((a, b) => b.amount - a.amount);

    // Draw header table for categories
    doc.setFillColor(241, 245, 249); // slate-100
    doc.rect(15, y, 180, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    doc.text('Nama Kategori Pengeluaran', 18, y + 5.5);
    doc.text('Nominal Terpakai', 100, y + 5.5);
    doc.text('Persentase (%)', 155, y + 5.5);
    y += 8;

    doc.setFont('helvetica', 'normal');
    sortedStats.forEach((stat, idx) => {
      // zebra stripe
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(15, y, 180, 7, 'F');
      }
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text(stat.category, 18, y + 5);
      doc.text(formatRupiah(stat.amount), 100, y + 5);
      doc.text(`${stat.percentage.toFixed(1)} %`, 155, y + 5);
      y += 7;
    });
    y += 8;
  }

  // Page limit checking helper
  const checkPageOverflow = (neededHeight) => {
    if (y + neededHeight > 275) {
      doc.addPage();
      y = 20;

      // Draw standard inner page header
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184); // slate-400
      doc.text('Laporan Ringkasan Keuangan DompetKu', 15, 12);
      doc.line(15, 14, 195, 14);
      y = 22;
    }
  };

  // 3. Section: Mutasi Rekening Seluruhnya
  checkPageOverflow(20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text('3. Detail Riwayat Mutasi Rekening', 15, y);
  doc.line(15, y + 2, 195, y + 2);
  y += 8;

  if (transactions.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('Belum ada riwayat transaksi terdaftar.', 15, y);
  } else {
    // Sort transactions chronologically or by input date (latest first)
    const sortedTx = [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date));

    // Draw header table for mutations
    doc.setFillColor(241, 245, 249); // slate-100
    doc.rect(15, y, 180, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    doc.text('Tanggal', 18, y + 5.5);
    doc.text('Kategori & Catatan', 55, y + 5.5);
    doc.text('Aliran', 135, y + 5.5);
    doc.text('Nominal Rupiah', 160, y + 5.5);
    y += 8;

    sortedTx.forEach((tx, idx) => {
      checkPageOverflow(10);
      
      // zebra stripe
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(15, y, 180, 8.5, 'F');
      }

      // Format date beautifully
      let localizedDate = tx.date;
      try {
        localizedDate = new Intl.DateTimeFormat('id-ID', {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        }).format(new Date(tx.date));
      } catch (e) {}

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text(localizedDate, 18, y + 5.5);

      // Category + Description (with limit truncation to avoid layout overlap)
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(51, 65, 85);
      const catText = tx.category || 'Lainnya';
      doc.text(catText, 55, y + 4.5);

      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      let descText = tx.description || '-';
      if (descText.length > 40) descText = descText.substring(0, 38) + '...';
      doc.text(descText, 55, y + 7.5);

      // Aliran
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      if (tx.type === 'income') {
        doc.setTextColor(16, 185, 129); // emerald green
        doc.text('MASUK', 135, y + 5.5);
        doc.text(`+ ${formatRupiah(tx.amount)}`, 160, y + 5.5);
      } else {
        doc.setTextColor(239, 68, 68); // rose red
        doc.text('KELUAR', 135, y + 5.5);
        doc.text(`- ${formatRupiah(tx.amount)}`, 160, y + 5.5);
      }

      y += 8.5;
    });
  }

  // Footnote standard
  checkPageOverflow(15);
  y += 8;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.line(15, y, 195, y);
  
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184);
  doc.text('Laporan ini diunduh secara otomatis dari aplikasi DompetKu Personal Anda.', 15, y + 5);
  doc.text('Daftar data tersinkronisasi aman dengan Google Firebase Cloud Servers.', 15, y + 8);

  // Save the PDF doc
  const userPrefix = currentUser ? currentUser.displayName.replace(/\s+/g, '_') : 'User';
  doc.save(`Laporan_DompetKu_${userPrefix}_${new Date().toISOString().slice(0,10)}.pdf`);
  
  showToast('Laporan dashboard PDF Anda berhasil diunduh!', 'success');
}

// ==========================================
// LAYOUT STATE MANAGEMENT & AUTENTIKASI
// ==========================================

function showToast(message, type = 'danger') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const duration = 4000;
  
  const bgClass = type === 'success' 
    ? 'bg-emerald-600 border border-emerald-500 text-white' 
    : type === 'warning' 
    ? 'bg-amber-500 border border-amber-400 text-white' 
    : 'bg-rose-600 border border-rose-500 text-white';
    
  const iconClass = type === 'success'
    ? 'fa-solid fa-circle-check'
    : type === 'warning'
    ? 'fa-solid fa-triangle-exclamation'
    : 'fa-solid fa-circle-exclamation';

  toast.className = `flex items-center gap-3 py-3 px-4 rounded-2xl ${bgClass} shadow-xl text-xs font-semibold transform translate-y-3 opacity-0 transition-all duration-300 backdrop-blur-xs`;
  toast.innerHTML = `
    <i class="${iconClass} text-sm"></i>
    <span class="flex-1">${message}</span>
  `;

  container.appendChild(toast);

  // Trigger entering animation
  setTimeout(() => {
    toast.classList.remove('translate-y-3', 'opacity-0');
  }, 10);

  // Auto remove
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-1');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, duration);
}

function showCustomConfirm({ title, message, iconClass, iconBgClass, submitText, submitBtnBgClass, onConfirm }) {
  const modal = document.getElementById('custom-confirm-modal');
  const modalIconBg = document.getElementById('confirm-modal-icon-bg');
  const modalIcon = document.getElementById('confirm-modal-icon');
  const modalTitle = document.getElementById('confirm-modal-title');
  const modalMessage = document.getElementById('confirm-modal-message');
  const modalCancel = document.getElementById('confirm-modal-cancel');
  const modalSubmit = document.getElementById('confirm-modal-submit');

  if (!modal) return;

  modalTitle.textContent = title;
  modalMessage.textContent = message;
  
  if (iconClass) modalIcon.className = iconClass;
  if (iconBgClass) modalIconBg.className = `w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBgClass}`;
  
  if (submitText) modalSubmit.textContent = submitText;
  if (submitBtnBgClass) modalSubmit.className = `flex-1 py-3 px-4 text-white font-bold text-xs rounded-xl shadow-md transition-all uppercase tracking-wider cursor-pointer ${submitBtnBgClass}`;

  // Reset listeners by cloning buttons
  const newSubmit = modalSubmit.cloneNode(true);
  const newCancel = modalCancel.cloneNode(true);
  modalSubmit.parentNode.replaceChild(newSubmit, modalSubmit);
  modalCancel.parentNode.replaceChild(newCancel, modalCancel);

  // Show modal
  modal.classList.remove('hidden');
  
  newSubmit.addEventListener('click', () => {
    modal.classList.add('hidden');
    onConfirm();
  });

  newCancel.addEventListener('click', () => {
    modal.classList.add('hidden');
  });
}

function showAuthInstructionsModal() {
  const modal = document.getElementById('auth-instructions-modal');
  const domainText1 = document.getElementById('modal-trouble-domain');
  const domainText2 = document.getElementById('modal-trouble-domain-copy');
  const closeBtn = document.getElementById('auth-instructions-close');

  if (!modal) return;

  const currentHost = window.location.hostname;
  if (domainText1) domainText1.textContent = currentHost;
  if (domainText2) domainText2.textContent = currentHost;

  modal.classList.remove('hidden');

  closeBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
  }, { once: true });
}

async function handleGoogleLogin() {
  try {
    loadingScreen.classList.remove('hidden');
    appScreen.classList.add('hidden');
    authScreen.classList.add('hidden');
    
    // Memulai login popup menggunakan Google Provider
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    loadingScreen.classList.add('hidden');
    authScreen.classList.remove('hidden');
    console.error("Login gagal: ", err);

    const errorCode = err.code;

    if (errorCode === 'auth/unauthorized-domain') {
      showAuthInstructionsModal();
    } else if (errorCode === 'auth/popup-blocked') {
      showToast('Pop-up masuk diblokir oleh browser Anda. Silakan izinkan pop-up untuk situs ini dan coba lagi.', 'warning');
    } else if (errorCode === 'auth/popup-closed-by-user') {
      showToast('Login dibatalkan oleh pengguna.', 'warning');
    } else {
      // Jika terjadi kesalahan lain pada domain yang dideploy (misal Vercel), tampilkan panduan Authorized Domains
      const currentHost = window.location.hostname;
      const isLocalOrFirebase = currentHost === 'localhost' || 
                                currentHost === '127.0.0.1' || 
                                currentHost.endsWith('.firebaseapp.com') || 
                                currentHost.endsWith('.web.app');
      
      if (!isLocalOrFirebase) {
        showAuthInstructionsModal();
      } else {
        showToast('Gagal masuk: ' + (err.message || 'masalah jaringan atau setelan browser'), 'danger');
      }
    }
  }
}

async function handleLogout() {
  if (isGuestMode) {
    showCustomConfirm({
      title: 'Keluar Mode Tamu',
      message: 'Apakah Anda yakin ingin keluar dari Mode Tamu? Semua data Anda tetap aman berada di dalam browser ini.',
      iconClass: 'fa-solid fa-power-off text-lg',
      iconBgClass: 'bg-rose-50 text-rose-600 border border-rose-100',
      submitText: 'Keluar',
      submitBtnBgClass: 'bg-slate-900 hover:bg-slate-800 active:scale-95',
      onConfirm: () => {
        loadingScreen.classList.remove('hidden');
        setTimeout(() => {
          isGuestMode = false;
          localStorage.removeItem('dompetku_is_guest');
          transactions = [];
          
          const syncStatus = document.getElementById('sync-status');
          const syncDot = document.getElementById('sync-status-dot');
          if (syncStatus) {
            syncStatus.className = 'text-[10px] text-indigo-600 font-bold uppercase tracking-widest flex items-center justify-center md:justify-start gap-1';
            syncStatus.querySelector('span:not(#sync-status-dot)').textContent = 'Jejak Finansialku';
          }
          if (syncDot) {
            syncDot.className = 'w-1.5 h-1.5 bg-indigo-500 rounded-full inline-block animate-pulse';
          }
          
          updateDashboard();
          renderTransactions();
          
          appScreen.classList.add('hidden');
          authScreen.classList.remove('hidden');
          loadingScreen.classList.add('hidden');
          showToast('Anda berhasil keluar dari Mode Tamu.', 'success');
        }, 400);
      }
    });
    return;
  }

  showCustomConfirm({
    title: 'Konfirmasi Keluar',
    message: 'Apakah Anda yakin ingin keluar dari akun Google di DompetKu?',
    iconClass: 'fa-solid fa-power-off text-lg',
    iconBgClass: 'bg-rose-50 text-rose-605 border border-rose-100',
    submitText: 'Keluar',
    submitBtnBgClass: 'bg-slate-900 hover:bg-slate-800 active:scale-95 focus:ring-2 focus:ring-indigo-500/20',
    onConfirm: async () => {
      try {
        loadingScreen.classList.remove('hidden');
        appScreen.classList.add('hidden');
        
        if (queryUnsubscribe) {
          queryUnsubscribe();
          queryUnsubscribe = null;
        }
        
        await signOut(auth);
      } catch (err) {
        loadingScreen.classList.add('hidden');
        appScreen.classList.remove('hidden');
        console.error("Logout gagal: ", err);
      }
    }
  });
}

// ==========================================
// INISIALISASI & EVENT LISTENERS
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  // Bind elemen otentikasi
  loadingScreen = document.getElementById('loading-screen');
  authScreen = document.getElementById('auth-screen');
  appScreen = document.getElementById('app-screen');
  loginBtn = document.getElementById('login-btn');
  logoutBtn = document.getElementById('logout-btn');
  userAvatar = document.getElementById('user-avatar');
  userName = document.getElementById('user-name');

  // Bind elemen input & form
  formTransaction = document.getElementById('transaction-form');
  inputId = document.getElementById('transaction-id');
  radioIncome = document.getElementById('type-income');
  radioExpense = document.getElementById('type-expense');
  selectCategory = document.getElementById('transaction-category');
  inputAmount = document.getElementById('transaction-amount');
  inputDate = document.getElementById('transaction-date');
  inputDescription = document.getElementById('transaction-description');
  submitBtn = document.getElementById('submit-btn');
  cancelBtn = document.getElementById('cancel-btn');

  textTotalBalance = document.getElementById('total-balance');
  textTotalIncome = document.getElementById('total-income');
  textTotalExpense = document.getElementById('total-expense');
  listTransactions = document.getElementById('transaction-list');

  searchInput = document.getElementById('search-input');
  filterAll = document.getElementById('filter-all');
  filterIncome = document.getElementById('filter-income');
  filterExpense = document.getElementById('filter-expense');

  // Event listener tombol login/logout
  loginBtn.addEventListener('click', handleGoogleLogin);
  logoutBtn.addEventListener('click', handleLogout);

  const guestLoginBtn = document.getElementById('guest-login-btn');
  if (guestLoginBtn) {
    guestLoginBtn.addEventListener('click', () => {
      loadingScreen.classList.remove('hidden');
      setTimeout(() => {
        isGuestMode = true;
        localStorage.setItem('dompetku_is_guest', 'true');

        // Set user UI
        userAvatar.src = 'https://www.gravatar.com/avatar/?d=mp';
        userName.textContent = 'Mode Tamu DompetKu';

        // Update sync-status badge visual
        const syncStatus = document.getElementById('sync-status');
        const syncDot = document.getElementById('sync-status-dot');
        if (syncStatus) {
          syncStatus.className = 'text-[10px] text-amber-600 font-bold uppercase tracking-widest flex items-center justify-center md:justify-start gap-1';
          const spanLabel = syncStatus.querySelector('span:not(#sync-status-dot)');
          if (spanLabel) spanLabel.textContent = 'Mode Tamu (Offline)';
        }
        if (syncDot) {
          syncDot.className = 'w-1.5 h-1.5 bg-amber-500 rounded-full inline-block animate-pulse';
        }

        // Load transactions
        const stored = localStorage.getItem('dompetku_guest_transactions');
        if (stored) {
          try {
            transactions = JSON.parse(stored);
          } catch(e) {
            transactions = [];
          }
        } else {
          transactions = [];
        }

        authScreen.classList.add('hidden');
        appScreen.classList.remove('hidden');
        loadingScreen.classList.add('hidden');

        resetForm();
        updateDashboard();
        renderTransactions();
        showToast('Berhasil masuk menggunakan Mode Tamu Offline!', 'success');
      }, 405);
    });
  }

  // Setup dropdown kategori & event listeners form
  radioIncome.addEventListener('change', updateCategoryDropdown);
  radioExpense.addEventListener('change', updateCategoryDropdown);
  formTransaction.addEventListener('submit', handleFormSubmit);

  cancelBtn.addEventListener('click', (e) => {
    e.preventDefault();
    resetForm();
    const mobileTabDashboard = document.getElementById('mobile-tab-dashboard');
    if (mobileTabDashboard && window.innerWidth < 768) {
      mobileTabDashboard.click();
    }
  });

  // Mobile tab navigation & responsive layout adaptation
  const mobileTabDashboard = document.getElementById('mobile-tab-dashboard');
  const mobileTabForm = document.getElementById('mobile-tab-form');
  const asidePanel = document.getElementById('aside-panel');
  const mainPanel = document.getElementById('main-panel');
  let currentMobileTab = 'dashboard';

  const mediaQuery = window.matchMedia('(min-width: 768px)');

  function updateResponsiveLayout() {
    if (mediaQuery.matches) {
      // Desktop screen (>=768px): always show both panels
      if (asidePanel) asidePanel.classList.remove('hidden');
      if (mainPanel) mainPanel.classList.remove('hidden');
    } else {
      // Mobile screen (<768px): toggle visibility based on selection
      if (currentMobileTab === 'dashboard') {
        if (asidePanel) asidePanel.classList.add('hidden');
        if (mainPanel) mainPanel.classList.remove('hidden');
        if (mobileTabDashboard) {
          mobileTabDashboard.className = 'flex-1 py-3 text-xs font-bold rounded-xl bg-slate-900 text-white shadow-sm transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer';
        }
        if (mobileTabForm) {
          mobileTabForm.className = 'flex-1 py-3 text-xs font-bold rounded-xl text-slate-500 hover:text-slate-850 transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer';
        }
      } else {
        if (asidePanel) asidePanel.classList.remove('hidden');
        if (mainPanel) mainPanel.classList.add('hidden');
        if (mobileTabDashboard) {
          mobileTabDashboard.className = 'flex-1 py-3 text-xs font-bold rounded-xl text-slate-500 hover:text-slate-850 transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer';
        }
        if (mobileTabForm) {
          mobileTabForm.className = 'flex-1 py-3 text-xs font-bold rounded-xl bg-slate-900 text-white shadow-sm transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer';
        }
      }
    }
  }

  if (mobileTabDashboard) {
    mobileTabDashboard.addEventListener('click', () => {
      currentMobileTab = 'dashboard';
      updateResponsiveLayout();
    });
  }

  if (mobileTabForm) {
    mobileTabForm.addEventListener('click', () => {
      currentMobileTab = 'form';
      updateResponsiveLayout();
    });
  }

  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener('change', updateResponsiveLayout);
  } else {
    mediaQuery.addListener(updateResponsiveLayout);
  }

  // Initial call on load
  updateResponsiveLayout();

  searchInput.addEventListener('input', renderTransactions);

  filterAll.addEventListener('click', () => {
    setCurrentFilter('all', filterAll);
  });
  filterIncome.addEventListener('click', () => {
    setCurrentFilter('income', filterIncome);
  });
  filterExpense.addEventListener('click', () => {
    setCurrentFilter('expense', filterExpense);
  });

  function setCurrentFilter(filterValue, activeBtn) {
    currentFilter = filterValue;
    
    [filterAll, filterIncome, filterExpense].forEach(btn => {
      btn.className = 'flex-1 py-2 text-xs font-bold rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-all duration-200 cursor-pointer text-center';
    });
    
    if (filterValue === 'all') {
      activeBtn.className = 'flex-1 py-2 text-xs font-bold rounded-lg bg-slate-900 text-white shadow-sm transition-all duration-200 cursor-pointer text-center';
    } else if (filterValue === 'income') {
      activeBtn.className = 'flex-1 py-2 text-xs font-bold rounded-lg bg-emerald-600 text-white shadow-sm transition-all duration-200 cursor-pointer text-center';
    } else {
      activeBtn.className = 'flex-1 py-2 text-xs font-bold rounded-lg bg-rose-600 text-white shadow-sm transition-all duration-200 cursor-pointer text-center';
    }

    renderTransactions();
  }

  // Bind export PDF button
  const downloadPdfBtn = document.getElementById('download-pdf-btn');
  if (downloadPdfBtn) {
    downloadPdfBtn.addEventListener('click', downloadPDFSummary);
  }

  // Tampilkan tanggal hari ini
  const textSubdate = document.getElementById('today-date');
  if (textSubdate) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    textSubdate.textContent = new Intl.DateTimeFormat('id-ID', options).format(new Date());
  }

  // Lakukan tes sambungan awal luring/daring ke Firestore
  testConnection();

  // Memasang pemantau state autentikasi pengguna secara dinamis
  onAuthStateChanged(auth, (user) => {
    if (user) {
      isGuestMode = false;
      localStorage.removeItem('dompetku_is_guest');

      const syncStatus = document.getElementById('sync-status');
      const syncDot = document.getElementById('sync-status-dot');
      if (syncStatus) {
        syncStatus.className = 'text-[10px] text-indigo-600 font-bold uppercase tracking-widest flex items-center justify-center md:justify-start gap-1';
        const spanLabel = syncStatus.querySelector('span:not(#sync-status-dot)');
        if (spanLabel) spanLabel.textContent = 'Jejak Finansialku';
      }
      if (syncDot) {
        syncDot.className = 'w-1.5 h-1.5 bg-indigo-500 rounded-full inline-block animate-pulse';
      }

      // Perbarui profile avatar & info
      userAvatar.src = user.photoURL || 'https://www.gravatar.com/avatar/?d=mp';
      userName.textContent = user.displayName || 'Pengguna DompetKu';

      // Sembunyikan cover autentikasi, tampilkan dashboard dashboard
      authScreen.classList.add('hidden');
      appScreen.classList.remove('hidden');
      loadingScreen.classList.add('hidden');

      // Terapkan default form setup
      resetForm();

      // Sinkronkan data transaksi terpilih dari Firestore sesuai userId terotentikasi secara real-time
      const transactionsCollection = collection(db, 'transactions');
      const q = query(transactionsCollection, where('userId', '==', user.uid));
      
      if (queryUnsubscribe) {
        queryUnsubscribe();
      }

      queryUnsubscribe = onSnapshot(q, (snapshot) => {
        transactions = [];
        snapshot.forEach((docSnap) => {
          transactions.push(docSnap.data());
        });

        // Mutakhirkan visual diagram & saring riwayat terkini
        updateDashboard();
        renderTransactions();
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'transactions');
      });

    } else {
      // Jika ada status login tamu sebelumnya, pulihkan secara offline
      if (localStorage.getItem('dompetku_is_guest') === 'true') {
        isGuestMode = true;
        
        userAvatar.src = 'https://www.gravatar.com/avatar/?d=mp';
        userName.textContent = 'Mode Tamu DompetKu';

        const syncStatus = document.getElementById('sync-status');
        const syncDot = document.getElementById('sync-status-dot');
        if (syncStatus) {
          syncStatus.className = 'text-[10px] text-amber-600 font-bold uppercase tracking-widest flex items-center justify-center md:justify-start gap-1';
          const spanLabel = syncStatus.querySelector('span:not(#sync-status-dot)');
          if (spanLabel) spanLabel.textContent = 'Mode Tamu (Offline)';
        }
        if (syncDot) {
          syncDot.className = 'w-1.5 h-1.5 bg-amber-500 rounded-full inline-block animate-pulse';
        }

        const stored = localStorage.getItem('dompetku_guest_transactions');
        if (stored) {
          try {
            transactions = JSON.parse(stored);
          } catch(e) {
            transactions = [];
          }
        } else {
          transactions = [];
        }

        authScreen.classList.add('hidden');
        appScreen.classList.remove('hidden');
        loadingScreen.classList.add('hidden');

        resetForm();
        updateDashboard();
        renderTransactions();
        return;
      }

      // Jika logout, bersihkan token dan batalkan sync database
      if (queryUnsubscribe) {
        queryUnsubscribe();
        queryUnsubscribe = null;
      }
      transactions = [];
      updateDashboard();
      renderTransactions();

      // Alihkan view layar landing-page Google sign-in
      appScreen.classList.add('hidden');
      authScreen.classList.remove('hidden');
      loadingScreen.classList.add('hidden');
    }
  });
});
