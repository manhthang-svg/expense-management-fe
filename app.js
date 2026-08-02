const API_BASE = window.EXPENSE_API_URL || 'http://localhost:8080/api';

const state = {
  currentMonth: startOfMonth(new Date()),
  selectedDate: stripTime(new Date()),
  expenses: [],
  categories: [],
  editingId: null,
  editingCategoryId: null,
  summaryMode: 'month',
  loading: false
};

const $ = (selector) => document.querySelector(selector);
const calendarGrid = $('#calendar-grid');
const dayPanel = $('#day-panel');
const backdrop = $('#panel-backdrop');
const form = $('#expense-form');
let toastTimer;

function stripTime(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function endOfMonth(date) { return new Date(date.getFullYear(), date.getMonth() + 1, 0); }
function addDays(date, days) { return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days); }
function addMonths(date, months) { return new Date(date.getFullYear(), date.getMonth() + months, 1); }
function toISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function parseISO(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}
function sameDay(a, b) { return toISO(a) === toISO(b); }
function formatMoney(value) { return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value || 0)); }
function formatCellTotal(value) { return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Number(value || 0))} ₫`; }
function formatAmountInput(value) {
  const digits = String(value).replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 13);
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
function parseAmount(value) { return Number(String(value).replace(/\D/g, '')); }
function shortMoney(value) {
  const amount = Number(value || 0);
  if (amount >= 1_000_000) return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(amount / 1_000_000)}tr`;
  if (amount >= 1_000) return `${Math.round(amount / 1_000)}k`;
  return formatMoney(amount);
}
function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
function monthGridRange() {
  const first = startOfMonth(state.currentMonth);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = addDays(first, -mondayOffset);
  return [start, addDays(start, 41)];
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success === false) {
    throw new Error(body?.message || 'Không thể kết nối tới máy chủ');
  }
  return body?.data;
}

async function loadExpenses() {
  const [start, end] = monthGridRange();
  state.loading = true;
  $('#calendar-loading').classList.remove('hidden');
  try {
    state.expenses = await api(`/expenses?startDate=${toISO(start)}&endDate=${toISO(end)}`) || [];
    renderAll();
  } catch (error) {
    state.expenses = [];
    renderAll();
    showToast(`${error.message}. Hãy kiểm tra trạng thái backend cloud và cấu hình CORS.`, true);
  } finally {
    state.loading = false;
    $('#calendar-loading').classList.add('hidden');
  }
}

async function loadCategories() {
  try {
    state.categories = await api('/categories') || [];
    renderCategoryOptions();
    renderCategoryManager();
  } catch (error) {
    state.categories = [];
    renderCategoryOptions();
    showToast(error.message, true);
  }
}

function renderCategoryOptions(selectedId) {
  const select = $('#category');
  const current = selectedId || Number(select.value) || state.categories[0]?.id;
  select.innerHTML = state.categories.length
    ? state.categories.map(category => `<option value="${category.id}">${escapeHTML(category.icon)} ${escapeHTML(category.name)}</option>`).join('')
    : '<option value="">Chưa có danh mục</option>';
  if (current) select.value = String(current);
}

function expensesFor(date) {
  const key = typeof date === 'string' ? date : toISO(date);
  return state.expenses.filter(item => item.expenseDate === key);
}
function totalOf(items) { return items.reduce((sum, item) => sum + Number(item.amount), 0); }

function renderAll() {
  renderCalendar();
  renderDayPanel();
}

function renderCalendar() {
  $('#month-title').textContent = new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric' }).format(state.currentMonth);
  const [start] = monthGridRange();
  const today = stripTime(new Date());
  calendarGrid.innerHTML = Array.from({ length: 42 }, (_, index) => {
    const date = addDays(start, index);
    const items = expensesFor(date);
    const isOutside = date.getMonth() !== state.currentMonth.getMonth();
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    const classes = ['calendar-day', isOutside && 'outside', isWeekend && 'day-weekend', sameDay(date, today) && 'today', sameDay(date, state.selectedDate) && 'selected'].filter(Boolean).join(' ');
    const previews = items.slice(0, 2).map(item => `
      <div class="preview-item"><i class="preview-dot"></i><span class="preview-text">${escapeHTML(item.description)}</span></div>`).join('');
    return `<button class="${classes}" type="button" data-date="${toISO(date)}" aria-label="Ngày ${date.getDate()}">
      <span class="day-number">${date.getDate()}</span>
      <div class="day-preview">${previews}${items.length > 2 ? `<span class="more-count">+${items.length - 2} khoản khác</span>` : ''}</div>
      ${items.length ? `<span class="cell-total">${formatCellTotal(totalOf(items))}</span>` : ''}
    </button>`;
  }).join('');
}

function renderDayPanel() {
  const items = expensesFor(state.selectedDate);
  const dateLabel = new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' }).format(state.selectedDate);
  const weekday = new Intl.DateTimeFormat('vi-VN', { weekday: 'long' }).format(state.selectedDate);
  $('#selected-weekday').textContent = sameDay(state.selectedDate, new Date()) ? 'Hôm nay' : weekday;
  $('#selected-date').textContent = dateLabel;
  $('#day-total').textContent = formatMoney(totalOf(items));
  $('#day-count').textContent = items.length ? `${items.length} khoản chi · tổng được cập nhật tự động` : 'Chưa có khoản chi';
  $('#expense-count-badge').textContent = items.length;

  $('#expense-list').innerHTML = items.length ? items.map(item => {
    const category = item.category || { name: 'Khác', icon: '✨', color: '#F9BAD1' };
    return `<article class="expense-item">
      <span class="category-icon" style="background:${escapeHTML(category.color)}1f" title="${escapeHTML(category.name)}">${escapeHTML(category.icon)}</span>
      <div class="expense-info"><strong>${escapeHTML(item.description)}</strong><small>${escapeHTML(category.name)}</small></div>
      <div class="expense-actions">
        <span class="expense-amount">${formatMoney(item.amount)}</span>
        <button class="mini-button edit-expense" type="button" data-id="${item.id}" aria-label="Sửa"><svg viewBox="0 0 24 24"><path d="m4 20 4.3-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Zm10-12 3 3"/></svg></button>
        <button class="mini-button delete delete-expense" type="button" data-id="${item.id}" aria-label="Xóa"><svg viewBox="0 0 24 24"><path d="M4 7h16m-10 4v5m4-5v5M9 7l1-3h4l1 3m3 0-1 13H7L6 7"/></svg></button>
      </div>
    </article>`;
  }).join('') : `<div class="empty-state"><span>🪴</span><p>Ngày này chưa có khoản chi.<br>Thêm khoản đầu tiên ở phía trên.</p></div>`;
}

function selectDate(date) {
  const previousMonth = state.currentMonth.getMonth();
  state.selectedDate = stripTime(date);
  resetForm();
  if (date.getMonth() !== previousMonth || date.getFullYear() !== state.currentMonth.getFullYear()) {
    state.currentMonth = startOfMonth(date);
    loadExpenses();
  } else {
    renderAll();
  }
  if (window.innerWidth <= 820) openPanel();
}

function openPanel() {
  dayPanel.classList.add('open');
  backdrop.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closePanel() {
  dayPanel.classList.remove('open');
  backdrop.classList.add('hidden');
  document.body.style.overflow = '';
}

function resetForm() {
  state.editingId = null;
  form.reset();
  renderCategoryOptions(state.categories[0]?.id);
  $('#form-title').textContent = 'Thêm khoản chi';
  $('#submit-expense span').textContent = 'Lưu khoản chi';
  $('#cancel-edit').classList.add('hidden');
}

function beginEdit(id) {
  const item = state.expenses.find(expense => expense.id === id);
  if (!item) return;
  state.editingId = id;
  $('#description').value = item.description;
  $('#amount').value = formatAmountInput(item.amount);
  renderCategoryOptions(item.category?.id);
  $('#form-title').textContent = 'Chỉnh sửa khoản chi';
  $('#submit-expense span').textContent = 'Cập nhật khoản chi';
  $('#cancel-edit').classList.remove('hidden');
  $('#description').focus();
}

async function submitExpense(event) {
  event.preventDefault();
  const description = $('#description').value.trim();
  const amount = parseAmount($('#amount').value);
  if (!description || !Number.isFinite(amount) || amount <= 0) {
    showToast('Vui lòng nhập nội dung và số tiền lớn hơn 0.', true);
    return;
  }
  const categoryId = Number($('#category').value);
  if (!categoryId) {
    showToast('Vui lòng tạo và chọn một danh mục.', true);
    return;
  }
  const payload = { description, amount, categoryId, expenseDate: toISO(state.selectedDate) };
  const submitButton = $('#submit-expense');
  submitButton.disabled = true;
  try {
    if (state.editingId) {
      await api(`/expenses/${state.editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('Đã cập nhật khoản chi.');
    } else {
      await api('/expenses', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Đã thêm khoản chi mới.');
    }
    resetForm();
    await loadExpenses();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
}

async function deleteExpense(id) {
  const item = state.expenses.find(expense => expense.id === id);
  if (!item || !window.confirm(`Xóa khoản chi “${item.description}”?`)) return;
  try {
    await api(`/expenses/${id}`, { method: 'DELETE' });
    if (state.editingId === id) resetForm();
    showToast('Đã xóa khoản chi.');
    await loadExpenses();
  } catch (error) {
    showToast(error.message, true);
  }
}

function renderCategoryManager() {
  $('#category-list').innerHTML = state.categories.length ? state.categories.map(category => `
    <article class="category-manager-item">
      <span class="category-color-icon" style="background:${escapeHTML(category.color)}1f">${escapeHTML(category.icon)}</span>
      <strong>${escapeHTML(category.name)}</strong>
      <div class="category-manager-actions">
        <button class="mini-button edit-category" data-id="${category.id}" type="button" aria-label="Sửa danh mục"><svg viewBox="0 0 24 24"><path d="m4 20 4.3-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Zm10-12 3 3"/></svg></button>
        <button class="mini-button delete delete-category" data-id="${category.id}" type="button" aria-label="Xóa danh mục"><svg viewBox="0 0 24 24"><path d="M4 7h16m-10 4v5m4-5v5M9 7l1-3h4l1 3m3 0-1 13H7L6 7"/></svg></button>
      </div>
    </article>`).join('') : '<div class="empty-state"><p>Chưa có danh mục. Hãy tạo danh mục đầu tiên.</p></div>';
}

function resetCategoryForm() {
  state.editingCategoryId = null;
  $('#category-form').reset();
  $('#category-icon').value = '✨';
  $('#category-color').value = '#f9bad1';
  $('#save-category').textContent = 'Thêm';
  $('#cancel-category-edit').classList.add('hidden');
}

function beginCategoryEdit(id) {
  const category = state.categories.find(item => item.id === id);
  if (!category) return;
  state.editingCategoryId = id;
  $('#category-name').value = category.name;
  $('#category-icon').value = category.icon;
  $('#category-color').value = category.color;
  $('#save-category').textContent = 'Lưu';
  $('#cancel-category-edit').classList.remove('hidden');
  $('#category-name').focus();
}

async function submitCategory(event) {
  event.preventDefault();
  const payload = {
    name: $('#category-name').value.trim(),
    icon: $('#category-icon').value.trim() || '✨',
    color: $('#category-color').value
  };
  if (!payload.name) return;
  try {
    if (state.editingCategoryId) {
      await api(`/categories/${state.editingCategoryId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('Đã cập nhật danh mục.');
    } else {
      await api('/categories', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Đã thêm danh mục.');
    }
    resetCategoryForm();
    await loadCategories();
    await loadExpenses();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function deleteCategory(id) {
  const category = state.categories.find(item => item.id === id);
  if (!category || !window.confirm(`Xóa danh mục “${category.name}”? Các khoản chi cũ vẫn được giữ lại.`)) return;
  try {
    await api(`/categories/${id}`, { method: 'DELETE' });
    if (state.editingCategoryId === id) resetCategoryForm();
    showToast('Đã xóa danh mục.');
    await loadCategories();
  } catch (error) {
    showToast(error.message, true);
  }
}

function renderSummary(mode = 'month', openDialog = true) {
  state.summaryMode = mode;
  const mondayOffset = (state.selectedDate.getDay() + 6) % 7;
  const rangeStart = mode === 'week' ? addDays(state.selectedDate, -mondayOffset) : startOfMonth(state.currentMonth);
  const rangeEnd = mode === 'week' ? addDays(rangeStart, 6) : endOfMonth(state.currentMonth);
  const items = state.expenses.filter(item => {
    const date = parseISO(item.expenseDate);
    return date >= rangeStart && date <= rangeEnd;
  });
  const monthTotal = totalOf(items);
  const daily = new Map();
  const categories = new Map();
  items.forEach(item => {
    daily.set(item.expenseDate, (daily.get(item.expenseDate) || 0) + Number(item.amount));
    const key = item.category?.id || 0;
    const current = categories.get(key) || { category: item.category || { name: 'Khác', icon: '✨', color: '#F9BAD1' }, amount: 0 };
    current.amount += Number(item.amount);
    categories.set(key, current);
  });
  const highest = [...daily.entries()].sort((a, b) => b[1] - a[1])[0];
  $('#summary-month').textContent = mode === 'week'
    ? `${rangeStart.getDate()}/${rangeStart.getMonth() + 1} – ${rangeEnd.getDate()}/${rangeEnd.getMonth() + 1}/${rangeEnd.getFullYear()}`
    : new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric' }).format(state.currentMonth);
  $('#month-total').textContent = formatMoney(monthTotal);
  $('#month-count').textContent = `${items.length} khoản chi trong ${mode === 'week' ? 'tuần' : 'tháng'}`;
  $('#summary-total-label').textContent = `Tổng đã chi trong ${mode === 'week' ? 'tuần' : 'tháng'}`;
  $('#average-label').textContent = mode === 'week' ? 'Trung bình/ngày' : 'Trung bình/ngày chi';
  document.querySelectorAll('[data-summary-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.summaryMode === mode);
    button.setAttribute('aria-selected', button.dataset.summaryMode === mode);
  });
  $('#summary-day-total').textContent = formatMoney(totalOf(expensesFor(state.selectedDate)));
  $('#highest-day').textContent = highest ? `${parseISO(highest[0]).getDate()}/${parseISO(highest[0]).getMonth() + 1} · ${shortMoney(highest[1])}` : '—';
  $('#daily-average').textContent = formatMoney(mode === 'week' ? monthTotal / 7 : (daily.size ? monthTotal / daily.size : 0));

  const sortedCategories = [...categories.values()].sort((a, b) => b.amount - a.amount);
  $('#category-bars').innerHTML = sortedCategories.length ? sortedCategories.map(({ category, amount }) => {
    const percent = monthTotal ? (amount / monthTotal) * 100 : 0;
    return `<div class="category-row"><span>${escapeHTML(category.icon)} ${escapeHTML(category.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${percent}%;background:${escapeHTML(category.color)}"></div></div><strong>${shortMoney(amount)}</strong></div>`;
  }).join('') : `<div class="empty-state"><p>Chưa có dữ liệu trong ${mode === 'week' ? 'tuần' : 'tháng'} này.</p></div>`;
  if (openDialog && !$('#summary-dialog').open) $('#summary-dialog').showModal();
}

function openSummary() { renderSummary(state.summaryMode, true); }

function navigateMonth(offset) {
  state.currentMonth = addMonths(state.currentMonth, offset);
  state.selectedDate = startOfMonth(state.currentMonth);
  resetForm();
  loadExpenses();
}

function showToast(message, isError = false) {
  const toast = $('#toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

calendarGrid.addEventListener('click', event => {
  const day = event.target.closest('.calendar-day');
  if (day) selectDate(parseISO(day.dataset.date));
});
$('#expense-list').addEventListener('click', event => {
  const edit = event.target.closest('.edit-expense');
  const remove = event.target.closest('.delete-expense');
  if (edit) beginEdit(Number(edit.dataset.id));
  if (remove) deleteExpense(Number(remove.dataset.id));
});
form.addEventListener('submit', submitExpense);
$('#amount').addEventListener('input', event => {
  event.target.value = formatAmountInput(event.target.value);
});
$('#cancel-edit').addEventListener('click', resetForm);
$('.previous-month').addEventListener('click', () => navigateMonth(-1));
$('.next-month').addEventListener('click', () => navigateMonth(1));
$('.today-button').addEventListener('click', () => {
  state.currentMonth = startOfMonth(new Date());
  state.selectedDate = stripTime(new Date());
  resetForm();
  loadExpenses();
});
$('.summary-button').addEventListener('click', openSummary);
document.querySelectorAll('[data-summary-mode]').forEach(button => {
  button.addEventListener('click', () => renderSummary(button.dataset.summaryMode, false));
});
$('.dialog-close').addEventListener('click', () => $('#summary-dialog').close());
$('#manage-categories').addEventListener('click', () => {
  resetCategoryForm();
  renderCategoryManager();
  $('#category-dialog').showModal();
});
$('.category-dialog-close').addEventListener('click', () => $('#category-dialog').close());
$('#category-form').addEventListener('submit', submitCategory);
$('#cancel-category-edit').addEventListener('click', resetCategoryForm);
$('#category-list').addEventListener('click', event => {
  const edit = event.target.closest('.edit-category');
  const remove = event.target.closest('.delete-category');
  if (edit) beginCategoryEdit(Number(edit.dataset.id));
  if (remove) deleteCategory(Number(remove.dataset.id));
});
$('.close-panel').addEventListener('click', closePanel);
backdrop.addEventListener('click', closePanel);
$('#summary-dialog').addEventListener('click', event => {
  if (event.target === $('#summary-dialog')) $('#summary-dialog').close();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && dayPanel.classList.contains('open')) closePanel();
});

renderAll();
loadCategories().then(loadExpenses);
