const API_BASE = window.EXPENSE_API_URL || 'http://localhost:8080/api';
const EXPENSE = 'EXPENSE';
const INCOME = 'INCOME';

const state = {
  currentMonth: startOfMonth(new Date()),
  selectedDate: stripTime(new Date()),
  expenses: [],
  categories: [],
  editingId: null,
  editingCategoryId: null,
  categoryFilter: EXPENSE,
  summaryMode: 'month',
  summaryAnchor: stripTime(new Date()),
  cashflowChart: null,
  cumulativeChart: null,
  loading: false
};

const $ = selector => document.querySelector(selector);
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
function startOfWeek(date) { return addDays(stripTime(date), -((date.getDay() + 6) % 7)); }
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
function formatMoney(value) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value || 0));
}
function formatAmountInput(value) {
  const digits = String(value).replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 13);
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
function parseAmount(value) { return Number(String(value).replace(/\D/g, '')); }
function shortMoney(value) {
  const amount = Math.abs(Number(value || 0));
  if (amount >= 1_000_000_000) return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(amount / 1_000_000_000)} tỷ`;
  if (amount >= 1_000_000) return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(amount / 1_000_000)}tr`;
  if (amount >= 1_000) return `${Math.round(amount / 1_000)}k`;
  return new Intl.NumberFormat('vi-VN').format(amount);
}
function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
function itemType(item) { return item.type || EXPENSE; }
function totalOf(items) { return items.reduce((sum, item) => sum + Number(item.amount), 0); }
function totalsOf(items) {
  const income = totalOf(items.filter(item => itemType(item) === INCOME));
  const expense = totalOf(items.filter(item => itemType(item) === EXPENSE));
  return { income, expense, balance: income - expense };
}
function currentTransactionType() {
  return form.querySelector('input[name="transactionType"]:checked')?.value || EXPENSE;
}
function monthGridRange() {
  const first = startOfMonth(state.currentMonth);
  const start = addDays(first, -((first.getDay() + 6) % 7));
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
    showToast(`${error.message}. Hãy kiểm tra backend tại cổng 8080 và quyền Local network.`, true);
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

function categoriesFor(type) {
  return state.categories.filter(category => (category.type || EXPENSE) === type);
}

function renderCategoryOptions(selectedId) {
  const select = $('#category');
  const options = categoriesFor(currentTransactionType());
  const current = selectedId || (options.some(item => item.id === Number(select.value)) ? Number(select.value) : options[0]?.id);
  select.innerHTML = options.length
    ? options.map(category => `<option value="${category.id}">${escapeHTML(category.icon)} ${escapeHTML(category.name)}</option>`).join('')
    : '<option value="">Chưa có danh mục phù hợp</option>';
  if (current && options.some(item => item.id === Number(current))) select.value = String(current);
}

function expensesFor(date) {
  const key = typeof date === 'string' ? date : toISO(date);
  return state.expenses.filter(item => item.expenseDate === key);
}

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
    const totals = totalsOf(items);
    const isOutside = date.getMonth() !== state.currentMonth.getMonth();
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    const classes = ['calendar-day', isOutside && 'outside', isWeekend && 'day-weekend', sameDay(date, today) && 'today', sameDay(date, state.selectedDate) && 'selected'].filter(Boolean).join(' ');
    const previews = items.slice(0, 2).map(item => `
      <div class="preview-item ${itemType(item).toLowerCase()}"><i class="preview-dot"></i><span class="preview-text">${escapeHTML(item.description)}</span></div>`).join('');
    const cashflow = items.length ? `
      <span class="cell-cashflow">
        ${totals.income ? `<b class="cell-income">＋${shortMoney(totals.income)}</b>` : ''}
        ${totals.expense ? `<b class="cell-expense">−${shortMoney(totals.expense)}</b>` : ''}
      </span>` : '';
    return `<button class="${classes}" type="button" data-date="${toISO(date)}" aria-label="Ngày ${date.getDate()}, vào ${formatMoney(totals.income)}, ra ${formatMoney(totals.expense)}">
      <span class="day-number">${date.getDate()}</span>
      <div class="day-preview">${previews}${items.length > 2 ? `<span class="more-count">+${items.length - 2} giao dịch</span>` : ''}</div>
      ${cashflow}
    </button>`;
  }).join('');
}

function renderDayPanel() {
  const items = expensesFor(state.selectedDate);
  const totals = totalsOf(items);
  const dateLabel = new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' }).format(state.selectedDate);
  const weekday = new Intl.DateTimeFormat('vi-VN', { weekday: 'long' }).format(state.selectedDate);
  $('#selected-weekday').textContent = sameDay(state.selectedDate, new Date()) ? 'Hôm nay' : weekday;
  $('#selected-date').textContent = dateLabel;
  $('#day-balance').textContent = formatMoney(totals.balance);
  $('#day-balance').classList.toggle('negative', totals.balance < 0);
  $('#day-income').textContent = formatMoney(totals.income);
  $('#day-expense').textContent = formatMoney(totals.expense);
  $('#day-count').textContent = items.length ? `${items.length} giao dịch · tổng được cập nhật tự động` : 'Chưa có giao dịch';
  $('#expense-count-badge').textContent = items.length;

  $('#expense-list').innerHTML = items.length ? items.map(item => {
    const category = item.category || { name: 'Khác', icon: '•', color: '#F9BAD1' };
    const type = itemType(item);
    return `<article class="expense-item ${type.toLowerCase()}">
      <span class="category-icon" style="background:${escapeHTML(category.color)}1f" title="${escapeHTML(category.name)}">${escapeHTML(category.icon)}</span>
      <div class="expense-info"><strong>${escapeHTML(item.description)}</strong><small>${type === INCOME ? 'Tiền vào' : 'Tiền ra'} · ${escapeHTML(category.name)}</small></div>
      <div class="expense-actions">
        <span class="expense-amount">${type === INCOME ? '+' : '−'}${formatMoney(item.amount)}</span>
        <button class="mini-button edit-expense" type="button" data-id="${item.id}" aria-label="Sửa giao dịch"><svg viewBox="0 0 24 24"><path d="m4 20 4.3-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Zm10-12 3 3"/></svg></button>
        <button class="mini-button delete delete-expense" type="button" data-id="${item.id}" aria-label="Xóa giao dịch"><svg viewBox="0 0 24 24"><path d="M4 7h16m-10 4v5m4-5v5M9 7l1-3h4l1 3m3 0-1 13H7L6 7"/></svg></button>
      </div>
    </article>`;
  }).join('') : `<div class="empty-state"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v12H4zM7 7V5h10v2M8 12h8"/></svg><p>Ngày này chưa có giao dịch.<br>Hãy thêm khoản đầu tiên ở phía trên.</p></div>`;
}

function selectDate(date) {
  const previousMonth = state.currentMonth.getMonth();
  const previousYear = state.currentMonth.getFullYear();
  state.selectedDate = stripTime(date);
  resetForm();
  if (date.getMonth() !== previousMonth || date.getFullYear() !== previousYear) {
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

function setTransactionType(type) {
  const radio = form.querySelector(`input[name="transactionType"][value="${type}"]`);
  if (radio) radio.checked = true;
  form.dataset.type = type;
}

function resetForm() {
  state.editingId = null;
  form.reset();
  setTransactionType(EXPENSE);
  renderCategoryOptions();
  $('#form-title').textContent = 'Thêm giao dịch';
  $('#submit-expense span').textContent = 'Lưu giao dịch';
  $('#cancel-edit').classList.add('hidden');
}

function beginEdit(id) {
  const item = state.expenses.find(expense => expense.id === id);
  if (!item) return;
  state.editingId = id;
  const type = itemType(item);
  setTransactionType(type);
  $('#description').value = item.description;
  $('#amount').value = formatAmountInput(item.amount);
  renderCategoryOptions(item.category?.id);
  $('#form-title').textContent = 'Chỉnh sửa giao dịch';
  $('#submit-expense span').textContent = 'Cập nhật giao dịch';
  $('#cancel-edit').classList.remove('hidden');
  $('#description').focus();
}

async function submitExpense(event) {
  event.preventDefault();
  const description = $('#description').value.trim();
  const amount = parseAmount($('#amount').value);
  const type = currentTransactionType();
  const categoryId = Number($('#category').value);
  if (!description || !Number.isFinite(amount) || amount <= 0) {
    showToast('Vui lòng nhập nội dung và số tiền lớn hơn 0.', true);
    return;
  }
  if (!categoryId) {
    showToast(`Vui lòng tạo một danh mục ${type === INCOME ? 'tiền vào' : 'tiền ra'} trước.`, true);
    return;
  }
  const payload = { description, amount, type, categoryId, expenseDate: toISO(state.selectedDate) };
  const submitButton = $('#submit-expense');
  submitButton.disabled = true;
  try {
    if (state.editingId) {
      await api(`/expenses/${state.editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('Đã cập nhật giao dịch.');
    } else {
      await api('/expenses', { method: 'POST', body: JSON.stringify(payload) });
      showToast(type === INCOME ? 'Đã thêm khoản tiền vào.' : 'Đã thêm khoản tiền ra.');
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
  if (!item || !window.confirm(`Xóa giao dịch “${item.description}”?`)) return;
  try {
    await api(`/expenses/${id}`, { method: 'DELETE' });
    if (state.editingId === id) resetForm();
    showToast('Đã xóa giao dịch.');
    await loadExpenses();
  } catch (error) {
    showToast(error.message, true);
  }
}

function setCategoryFilter(type) {
  state.categoryFilter = type;
  document.querySelectorAll('[data-category-filter]').forEach(button => {
    const active = button.dataset.categoryFilter === type;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  renderCategoryManager();
}

function renderCategoryManager() {
  const categories = categoriesFor(state.categoryFilter);
  $('#category-list').innerHTML = categories.length ? categories.map(category => `
    <article class="category-manager-item">
      <span class="category-color-icon" style="background:${escapeHTML(category.color)}1f">${escapeHTML(category.icon)}</span>
      <div class="category-manager-info"><strong>${escapeHTML(category.name)}</strong><small>${category.type === INCOME ? 'Tiền vào' : 'Tiền ra'}</small></div>
      <div class="category-manager-actions">
        <button class="mini-button edit-category" data-id="${category.id}" type="button" aria-label="Sửa danh mục"><svg viewBox="0 0 24 24"><path d="m4 20 4.3-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Zm10-12 3 3"/></svg></button>
        <button class="mini-button delete delete-category" data-id="${category.id}" type="button" aria-label="Xóa danh mục"><svg viewBox="0 0 24 24"><path d="M4 7h16m-10 4v5m4-5v5M9 7l1-3h4l1 3m3 0-1 13H7L6 7"/></svg></button>
      </div>
    </article>`).join('') : '<div class="empty-state"><p>Chưa có danh mục cho loại giao dịch này.</p></div>';
}

function resetCategoryForm() {
  state.editingCategoryId = null;
  $('#category-form').reset();
  $('#category-type').value = state.categoryFilter;
  $('#category-icon').value = '✨';
  $('#category-color').value = state.categoryFilter === INCOME ? '#248a70' : '#f9bad1';
  $('#save-category').textContent = 'Thêm';
  $('#cancel-category-edit').classList.add('hidden');
}

function beginCategoryEdit(id) {
  const category = state.categories.find(item => item.id === id);
  if (!category) return;
  state.editingCategoryId = id;
  $('#category-type').value = category.type || EXPENSE;
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
    type: $('#category-type').value,
    name: $('#category-name').value.trim(),
    icon: $('#category-icon').value.trim() || '•',
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
    setCategoryFilter(payload.type);
    resetCategoryForm();
    await loadCategories();
    await loadExpenses();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function deleteCategory(id) {
  const category = state.categories.find(item => item.id === id);
  if (!category || !window.confirm(`Xóa danh mục “${category.name}”? Các giao dịch cũ vẫn được giữ lại.`)) return;
  try {
    await api(`/categories/${id}`, { method: 'DELETE' });
    if (state.editingCategoryId === id) resetCategoryForm();
    showToast('Đã xóa danh mục.');
    await loadCategories();
  } catch (error) {
    showToast(error.message, true);
  }
}

function summaryRange() {
  if (state.summaryMode === 'week') {
    const start = startOfWeek(state.summaryAnchor);
    return [start, addDays(start, 6)];
  }
  if (state.summaryMode === 'year') {
    return [new Date(state.summaryAnchor.getFullYear(), 0, 1), new Date(state.summaryAnchor.getFullYear(), 11, 31)];
  }
  return [startOfMonth(state.summaryAnchor), endOfMonth(state.summaryAnchor)];
}

function summaryPeriodLabel(start, end) {
  if (state.summaryMode === 'week') {
    return `${start.getDate()}/${start.getMonth() + 1}/${start.getFullYear()} – ${end.getDate()}/${end.getMonth() + 1}/${end.getFullYear()}`;
  }
  if (state.summaryMode === 'year') return `Năm ${start.getFullYear()}`;
  return new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric' }).format(start);
}

function buildChartSeries(items, start, end) {
  let buckets;
  if (state.summaryMode === 'week') {
    buckets = Array.from({ length: 7 }, (_, index) => {
      const date = addDays(start, index);
      return { key: toISO(date), label: new Intl.DateTimeFormat('vi-VN', { weekday: 'short' }).format(date), income: 0, expense: 0 };
    });
  } else if (state.summaryMode === 'year') {
    buckets = Array.from({ length: 12 }, (_, index) => ({
      key: index,
      label: `T${index + 1}`,
      income: 0,
      expense: 0
    }));
  } else {
    const days = end.getDate();
    buckets = Array.from({ length: Math.ceil(days / 7) }, (_, index) => {
      const from = index * 7 + 1;
      const to = Math.min(from + 6, days);
      return { key: index, label: `${from}–${to}`, income: 0, expense: 0 };
    });
  }

  items.forEach(item => {
    const date = parseISO(item.expenseDate);
    const key = state.summaryMode === 'week'
      ? item.expenseDate
      : state.summaryMode === 'year'
        ? date.getMonth()
        : Math.floor((date.getDate() - 1) / 7);
    const bucket = buckets.find(entry => entry.key === key);
    if (bucket) bucket[itemType(item) === INCOME ? 'income' : 'expense'] += Number(item.amount);
  });
  return buckets;
}

function renderChart(buckets) {
  if (state.cashflowChart) {
    state.cashflowChart.destroy();
    state.cashflowChart = null;
  }
  const wrap = $('.chart-wrap');
  const fallback = $('#chart-fallback');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const chartSummary = buckets.map(bucket => `${bucket.label}: vào ${formatMoney(bucket.income)}, ra ${formatMoney(bucket.expense)}`).join('; ');
  $('#cashflow-chart').setAttribute('aria-label', `Biểu đồ dòng tiền. ${chartSummary}`);

  if (window.Chart) {
    wrap.classList.remove('hidden');
    fallback.classList.add('hidden');
    state.cashflowChart = new window.Chart($('#cashflow-chart'), {
      type: 'bar',
      data: {
        labels: buckets.map(bucket => bucket.label),
        datasets: [
          { label: 'Tiền vào', data: buckets.map(bucket => bucket.income), backgroundColor: '#248A70', borderRadius: 6, maxBarThickness: 34 },
          { label: 'Tiền ra', data: buckets.map(bucket => bucket.expense), backgroundColor: '#C94F7C', borderRadius: 6, maxBarThickness: 34 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reducedMotion ? false : { duration: 280 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: context => `${context.dataset.label}: ${formatMoney(context.raw)}` } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#6E7B73', maxRotation: 0 } },
          y: { beginAtZero: true, grid: { color: '#F2E7EB' }, ticks: { color: '#6E7B73', callback: value => shortMoney(value) } }
        }
      }
    });
    return;
  }

  wrap.classList.add('hidden');
  fallback.classList.remove('hidden');
  fallback.innerHTML = buckets.map(bucket => `
    <div class="fallback-row"><strong>${escapeHTML(bucket.label)}</strong><span class="fallback-income">Vào ${shortMoney(bucket.income)}</span><span class="fallback-expense">Ra ${shortMoney(bucket.expense)}</span></div>
  `).join('');
}

function buildCumulativePoints(items) {
  const orderedItems = [...items].sort((first, second) => {
    const dateOrder = first.expenseDate.localeCompare(second.expenseDate);
    if (dateOrder) return dateOrder;
    const createdOrder = String(first.createdAt || '').localeCompare(String(second.createdAt || ''));
    return createdOrder || Number(first.id) - Number(second.id);
  });
  let cumulative = 0;
  const points = [{
    label: 'Bắt đầu',
    dateLabel: 'Bắt đầu kỳ',
    description: 'Mốc bắt đầu',
    delta: 0,
    value: 0,
    type: null
  }];

  orderedItems.forEach(item => {
    const type = itemType(item);
    const delta = (type === INCOME ? 1 : -1) * Number(item.amount);
    cumulative += delta;
    const date = parseISO(item.expenseDate);
    points.push({
      label: `${date.getDate()}/${date.getMonth() + 1}`,
      dateLabel: new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' }).format(date),
      description: item.description,
      delta,
      value: cumulative,
      type
    });
  });
  return points;
}

function renderCumulativeChart(items) {
  if (state.cumulativeChart) {
    state.cumulativeChart.destroy();
    state.cumulativeChart = null;
  }
  const points = buildCumulativePoints(items);
  const values = points.map(point => point.value);
  const finalValue = values.at(-1) || 0;
  const highValue = Math.max(...values);
  const lowValue = Math.min(...values);
  const largestDrop = points
    .filter(point => point.delta < 0)
    .sort((first, second) => first.delta - second.delta)[0];

  $('#cumulative-final').textContent = formatMoney(finalValue);
  $('#cumulative-final').classList.toggle('negative', finalValue < 0);
  $('#cumulative-high').textContent = formatMoney(highValue);
  $('#cumulative-low').textContent = formatMoney(lowValue);
  $('#cumulative-low').classList.toggle('negative', lowValue < 0);
  $('#largest-drop').textContent = largestDrop ? `−${shortMoney(Math.abs(largestDrop.delta))}` : '—';
  $('#largest-drop').title = largestDrop ? `${largestDrop.description} · ${largestDrop.dateLabel}` : '';

  const accessibleSummary = `Dòng tiền lũy kế bắt đầu từ 0 đồng, kết thúc ${formatMoney(finalValue)}, cao nhất ${formatMoney(highValue)}, thấp nhất ${formatMoney(lowValue)}.`;
  $('#cumulative-chart').setAttribute('aria-label', accessibleSummary);
  const wrap = $('.cumulative-chart-wrap');
  const fallback = $('#cumulative-fallback');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (window.Chart) {
    wrap.classList.remove('hidden');
    fallback.classList.add('hidden');
    state.cumulativeChart = new window.Chart($('#cumulative-chart'), {
      type: 'line',
      data: {
        labels: points.map(point => point.label),
        datasets: [{
          label: 'Dòng tiền lũy kế',
          data: values,
          borderColor: '#248A70',
          borderWidth: 2.5,
          stepped: 'after',
          tension: 0,
          fill: false,
          pointRadius: points.length > 60 ? 1.5 : 3,
          pointHoverRadius: 5,
          pointBorderWidth: 2,
          pointBorderColor: '#FFFFFF',
          pointBackgroundColor: points.map(point => point.delta < 0 ? '#C94F7C' : point.delta > 0 ? '#248A70' : '#7B8790'),
          segment: {
            borderColor: context => points[context.p1DataIndex]?.delta < 0 ? '#C94F7C' : '#248A70'
          }
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        normalized: true,
        animation: reducedMotion ? false : { duration: 300 },
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: contexts => {
                const point = points[contexts[0]?.dataIndex];
                return point ? `${point.dateLabel} · ${point.description}` : '';
              },
              label: context => `Lũy kế: ${formatMoney(context.raw)}`,
              afterLabel: context => {
                const point = points[context.dataIndex];
                if (!point?.delta) return 'Mốc 0 ₫';
                return `${point.type === INCOME ? 'Tiền vào' : 'Tiền ra'}: ${point.delta > 0 ? '+' : '−'}${formatMoney(Math.abs(point.delta))}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#6E7B73', maxRotation: 0, autoSkip: true, maxTicksLimit: 12 }
          },
          y: {
            grid: {
              color: context => Number(context.tick.value) === 0 ? '#9B657A' : '#F2E7EB',
              lineWidth: context => Number(context.tick.value) === 0 ? 1.5 : 1
            },
            ticks: { color: '#6E7B73', callback: value => shortMoney(value) }
          }
        }
      }
    });
    return;
  }

  wrap.classList.add('hidden');
  fallback.classList.remove('hidden');
  fallback.innerHTML = points.map(point => `
    <div class="cumulative-fallback-row">
      <strong>${escapeHTML(point.label)}</strong>
      <span>${escapeHTML(point.description)}</span>
      <b class="${point.delta < 0 ? 'fallback-expense' : 'fallback-income'}">${formatMoney(point.value)}</b>
    </div>
  `).join('');
}

function renderSummary(items, start, end) {
  const incomeItems = items.filter(item => itemType(item) === INCOME);
  const expenseItems = items.filter(item => itemType(item) === EXPENSE);
  const totals = totalsOf(items);
  $('#summary-period').textContent = summaryPeriodLabel(start, end);
  $('#summary-income').textContent = formatMoney(totals.income);
  $('#summary-expense').textContent = formatMoney(totals.expense);
  $('#summary-balance').textContent = formatMoney(totals.balance);
  $('#summary-balance').classList.toggle('negative', totals.balance < 0);
  $('#income-count').textContent = `${incomeItems.length} giao dịch`;
  $('#expense-count').textContent = `${expenseItems.length} giao dịch`;
  $('#balance-note').textContent = totals.balance >= 0 ? 'Thu đang cao hơn chi' : 'Chi đang cao hơn thu';

  document.querySelectorAll('[data-summary-mode]').forEach(button => {
    const active = button.dataset.summaryMode === state.summaryMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });

  const buckets = buildChartSeries(items, start, end);
  renderChart(buckets);
  renderCumulativeChart(items);
  $('#chart-description').textContent = state.summaryMode === 'week'
    ? 'Theo từng ngày trong tuần'
    : state.summaryMode === 'month'
      ? 'Theo từng nhóm 7 ngày trong tháng'
      : 'Theo từng tháng trong năm';

  const categories = new Map();
  expenseItems.forEach(item => {
    const category = item.category || { id: 0, name: 'Khác', icon: '•', color: '#C94F7C' };
    const current = categories.get(category.id) || { category, amount: 0 };
    current.amount += Number(item.amount);
    categories.set(category.id, current);
  });
  const sortedCategories = [...categories.values()].sort((a, b) => b.amount - a.amount);
  $('#top-category').textContent = sortedCategories[0] ? `${sortedCategories[0].category.name} · ${shortMoney(sortedCategories[0].amount)}` : '—';
  $('#category-bars').innerHTML = sortedCategories.length ? sortedCategories.map(({ category, amount }) => {
    const percent = totals.expense ? (amount / totals.expense) * 100 : 0;
    return `<div class="category-row">
      <span title="${escapeHTML(category.name)}">${escapeHTML(category.icon)} ${escapeHTML(category.name)}</span>
      <div class="bar-track" role="img" aria-label="${escapeHTML(category.name)}: ${formatMoney(amount)}, ${Math.round(percent)} phần trăm"><div class="bar-fill" style="width:${percent}%;background:${escapeHTML(category.color)}"></div></div>
      <strong>${shortMoney(amount)}</strong>
    </div>`;
  }).join('') : '<div class="empty-state"><p>Chưa có tiền ra trong kỳ này.</p></div>';
}

async function loadSummary(openDialog = false) {
  const dialog = $('#summary-dialog');
  if (openDialog && !dialog.open) dialog.showModal();
  const [start, end] = summaryRange();
  $('#summary-loading').classList.remove('hidden');
  $('#summary-content').classList.add('summary-dimmed');
  try {
    const items = await api(`/expenses?startDate=${toISO(start)}&endDate=${toISO(end)}`) || [];
    renderSummary(items, start, end);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    $('#summary-loading').classList.add('hidden');
    $('#summary-content').classList.remove('summary-dimmed');
  }
}

function openSummary() {
  state.summaryAnchor = stripTime(state.selectedDate);
  loadSummary(true);
}

function shiftSummaryPeriod(offset) {
  if (state.summaryMode === 'week') state.summaryAnchor = addDays(state.summaryAnchor, offset * 7);
  else if (state.summaryMode === 'year') state.summaryAnchor = new Date(state.summaryAnchor.getFullYear() + offset, 0, 1);
  else state.summaryAnchor = addMonths(state.summaryAnchor, offset);
  loadSummary(false);
}

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
form.querySelectorAll('input[name="transactionType"]').forEach(radio => {
  radio.addEventListener('change', () => {
    form.dataset.type = currentTransactionType();
    renderCategoryOptions();
  });
});
$('#amount').addEventListener('input', event => { event.target.value = formatAmountInput(event.target.value); });
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
  button.addEventListener('click', () => {
    state.summaryMode = button.dataset.summaryMode;
    loadSummary(false);
  });
});
$('#previous-period').addEventListener('click', () => shiftSummaryPeriod(-1));
$('#next-period').addEventListener('click', () => shiftSummaryPeriod(1));
$('.dialog-close').addEventListener('click', () => $('#summary-dialog').close());
$('#manage-categories').addEventListener('click', () => {
  setCategoryFilter(currentTransactionType());
  resetCategoryForm();
  $('#category-dialog').showModal();
});
$('.category-dialog-close').addEventListener('click', () => $('#category-dialog').close());
$('#category-form').addEventListener('submit', submitCategory);
$('#cancel-category-edit').addEventListener('click', resetCategoryForm);
document.querySelectorAll('[data-category-filter]').forEach(button => {
  button.addEventListener('click', () => {
    setCategoryFilter(button.dataset.categoryFilter);
    resetCategoryForm();
  });
});
$('#category-list').addEventListener('click', event => {
  const edit = event.target.closest('.edit-category');
  const remove = event.target.closest('.delete-category');
  if (edit) beginCategoryEdit(Number(edit.dataset.id));
  if (remove) deleteCategory(Number(remove.dataset.id));
});
$('.close-panel').addEventListener('click', closePanel);
backdrop.addEventListener('click', closePanel);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && dayPanel.classList.contains('open')) closePanel();
});

setTransactionType(EXPENSE);
renderAll();
loadCategories().then(loadExpenses);
