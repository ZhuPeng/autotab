// 设置自动关闭的时间阈值（毫秒）
const INACTIVE_TIMEOUT = 1 * 60 * 1000; // 1分钟便于测试
let MAX_TABS = 50; // 默认最大标签页数量

// 存储标签页的最后访问时间
let tabLastAccessed = {};

// 加载用户设置
async function loadSettings() {
  const result = await chrome.storage.sync.get({
    maxTabs: 50 // 默认值
  });
  MAX_TABS = result.maxTabs;
  console.log('已加载设置: 最大标签页数量 =', MAX_TABS);
}

// 初始化已打开标签页的访问时间
async function initializeExistingTabs() {
  console.log('初始化已打开的标签页...');
  const tabs = await chrome.tabs.query({});
  const currentTime = Date.now();
  
  // 获取当前活动的标签页
  const activeTab = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTabId = activeTab[0]?.id;
  
  tabs.forEach(tab => {
    // 如果是当前活动的标签页，设置为当前时间
    // 其他标签页设置为稍早的时间，确保它们会被优先关闭
    if (tab.id === activeTabId) {
      tabLastAccessed[tab.id] = currentTime;
    } else {
      // 为其他标签页设置一个递减的时间，越早打开的标签页时间越早
      tabLastAccessed[tab.id] = currentTime - (INACTIVE_TIMEOUT / 2);
    }
    console.log(`初始化标签页 ${tab.id} (${tab.title})`);
  });
  
  await saveTabTimes();
}

// 监听标签页被激活的事件
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  console.log('标签页被激活:', activeInfo.tabId);
  tabLastAccessed[activeInfo.tabId] = Date.now();
  await saveTabTimes();
});

// 监听标签页更新的事件
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    console.log('标签页更新完成:', tabId, tab.title);
    tabLastAccessed[tabId] = Date.now();
    saveTabTimes();
  }
});

// 监听标签页关闭的事件
chrome.tabs.onRemoved.addListener((tabId) => {
  console.log('标签页被关闭:', tabId);
  delete tabLastAccessed[tabId];
  saveTabTimes();
});

// 检查标签页是否在编辑状态
async function isTabInEditingState(tab) {
  try {
    // 注入并执行检查脚本
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // 检查是否有未保存的表单
        const forms = document.forms;
        for (let form of forms) {
          const formData = new FormData(form);
          if (Array.from(formData.entries()).length > 0) {
            return true;
          }
        }

        // 检查是否有非空的文本输入框
        const inputs = document.querySelectorAll('input[type="text"], textarea');
        for (let input of inputs) {
          if (input.value.trim().length > 0) {
            return true;
          }
        }

        // 检查特定网站的编辑状态
        // Google Docs
        if (document.querySelector('.docs-title-input')) {
          return true;
        }
        // GitHub
        if (document.querySelector('.js-comment-field')) {
          return true;
        }
        // Gmail 撰写邮件
        if (document.querySelector('.compose-content')) {
          return true;
        }

        return false;
      }
    });

    // 如果至少有一个结果返回 true，则认为页面在编辑状态
    return results.some(result => result.result === true);
  } catch (error) {
    // 如果无法执行脚本（例如在chrome:// 页面），则假定页面不在编辑状态
    console.log(`无法检查标签页 ${tab.id} 的编辑状态:`, error);
    return false;
  }
}

// 定期检查并关闭不活跃的标签页
chrome.alarms.create('checkInactiveTabs', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'checkInactiveTabs') {
    console.log('----------------------------------------');
    console.log('开始检查不活跃标签页...');
    const tabs = await chrome.tabs.query({});
    const currentTime = Date.now();
    
    console.log(`当前打开的标签页数量: ${tabs.length}`);
    
    // 如果标签页数量未超过阈值，不进行关闭操作
    if (tabs.length <= MAX_TABS) {
      console.log(`当前标签数 (${tabs.length}) 未超过最大数量 (${MAX_TABS})，不进行关闭操作`);
      console.log('----------------------------------------');
      return;
    }
    
    // 获取所有标签的最后访问时间，并按时间排序
    const tabsWithTime = tabs.map(tab => ({
      ...tab,
      lastAccessed: tabLastAccessed[tab.id] || currentTime
    })).sort((a, b) => a.lastAccessed - b.lastAccessed);
    
    // 需要关闭的标签数量
    const targetCloseCount = tabs.length - MAX_TABS;
    console.log(`需要关闭 ${targetCloseCount} 个标签页以达到目标数量 ${MAX_TABS}`);
    console.log('----------------------------------------');
    
    let closedCount = 0;
    let checkedCount = 0;
    
    // 从最早未使用的标签开始检查，直到关闭足够数量的标签
    while (closedCount < targetCloseCount && checkedCount < tabs.length) {
      const tab = tabsWithTime[checkedCount];
      const inactiveTime = currentTime - tab.lastAccessed;
      const inactiveMinutes = Math.round(inactiveTime/1000/60);
      
      console.log(`\n[检查标签 ${checkedCount + 1}/${tabs.length}]`);
      console.log(`标题: ${tab.title}`);
      console.log(`未活动时间: ${inactiveMinutes} 分钟`);
      
      if (inactiveTime > INACTIVE_TIMEOUT) {
        // 检查页面是否在编辑状态
        const isEditing = await isTabInEditingState(tab);
        if (isEditing) {
          console.log(`状态: 正在编辑中，跳过关闭`);
          checkedCount++;
          continue;
        }

        // 保存关闭的标签页信息
        const closedTab = {
          title: tab.title,
          url: tab.url,
          closedAt: currentTime
        };
        
        const { closedTabs = [] } = await chrome.storage.local.get('closedTabs');
        closedTabs.push(closedTab);
        await chrome.storage.local.set({ closedTabs });
        
        // 关闭标签页
        await chrome.tabs.remove(tab.id);
        console.log(`状态: 已关闭 (${++closedCount}/${targetCloseCount})`);
      } else {
        console.log(`状态: 活动时间未超过阈值，保留`);
      }
      checkedCount++;
    }
    
    console.log('\n----------------------------------------');
    // 如果因为编辑状态而无法达到目标数量，记录日志
    if (closedCount < targetCloseCount) {
      console.log(`结果: 由于编辑状态的限制，只关闭了 ${closedCount} 个标签页，` +
                 `还有 ${targetCloseCount - closedCount} 个无法关闭`);
    } else {
      console.log(`结果: 成功关闭了 ${closedCount} 个标签页，达到了目标数量`);
    }
    console.log('----------------------------------------');
  }
});

// 保存标签页访问时间
async function saveTabTimes() {
  await chrome.storage.local.set({ tabLastAccessed });
}

// 监听设置变更
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.maxTabs) {
    MAX_TABS = changes.maxTabs.newValue;
    console.log('设置已更新: 最大标签页数量 =', MAX_TABS);
  }
});

// 初始化时加载保存的数据并处理已存在的标签页
chrome.runtime.onStartup.addListener(async () => {
  console.log('插件启动...');
  await loadSettings();
  const data = await chrome.storage.local.get('tabLastAccessed');
  tabLastAccessed = data.tabLastAccessed || {};
  await initializeExistingTabs();
});

// 插件安装或更新时也初始化标签页
chrome.runtime.onInstalled.addListener(async () => {
  console.log('插件安装或更新...');
  await loadSettings();
  await initializeExistingTabs();
}); 