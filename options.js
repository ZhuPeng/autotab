// 保存设置
function saveOptions() {
  const maxTabs = document.getElementById('maxTabs').value;
  const inactiveTimeout = document.getElementById('inactiveTimeout').value;
  const checkPeriod = document.getElementById('checkPeriod').value;
  
  chrome.storage.sync.set({
    maxTabs: Math.max(1, Math.min(200, parseInt(maxTabs) || 20)),
    inactiveTimeout: Math.max(1, Math.min(24, parseFloat(inactiveTimeout) || 4)),
    checkPeriod: Math.max(1, Math.min(1440, parseInt(checkPeriod) || 60))
  }, () => {
    // 更新状态显示
    const status = document.getElementById('status');
    status.style.display = 'block';
    setTimeout(() => {
      status.style.display = 'none';
    }, 2000);
  });
}

// 加载设置
function loadOptions() {
  chrome.storage.sync.get({
    maxTabs: 20,
    inactiveTimeout: 4,
    checkPeriod: 60
  }, (items) => {
    document.getElementById('maxTabs').value = items.maxTabs;
    document.getElementById('inactiveTimeout').value = items.inactiveTimeout;
    document.getElementById('checkPeriod').value = items.checkPeriod;
  });
}

document.addEventListener('DOMContentLoaded', loadOptions);
document.getElementById('save').addEventListener('click', saveOptions); 