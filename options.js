// 保存设置
function saveOptions() {
  const maxTabs = document.getElementById('maxTabs').value;
  chrome.storage.sync.set({
    maxTabs: Math.max(1, Math.min(200, parseInt(maxTabs) || 50))
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
    maxTabs: 50 // 默认值
  }, (items) => {
    document.getElementById('maxTabs').value = items.maxTabs;
  });
}

document.addEventListener('DOMContentLoaded', loadOptions);
document.getElementById('save').addEventListener('click', saveOptions); 