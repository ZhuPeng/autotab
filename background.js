// 设置自动关闭的时间阈值（毫秒）
const INACTIVE_TIMEOUT = 60 * 60 * 1000; // 1分钟便于测试
const MAX_TABS = 95; // 最大标签页数量

// 存储标签页的最后访问时间
let tabLastAccessed = {};

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
    console.log('开始检查不活跃标签页...');
    const tabs = await chrome.tabs.query({});
    const currentTime = Date.now();
    
    console.log('当前打开的标签页数量:', tabs.length);
    
    // 如果标签页数量未超过阈值，不进行关闭操作
    if (tabs.length <= MAX_TABS) {
      console.log(`当前标签数 (${tabs.length}) 未超过最大数量 (${MAX_TABS})，不进行关闭操作`);
      return;
    }
    
    // 获取所有标签的最后访问时间，并按时间排序
    const tabsWithTime = tabs.map(tab => ({
      ...tab,
      lastAccessed: tabLastAccessed[tab.id] || currentTime
    })).sort((a, b) => a.lastAccessed - b.lastAccessed);
    
    // 计算需要关闭的标签数量
    const tabsToClose = tabsWithTime.slice(0, tabs.length - MAX_TABS);
    console.log(`需要关闭 ${tabsToClose.length} 个标签页`);
    
    // 关闭最早未使用的标签
    for (const tab of tabsToClose) {
      const inactiveTime = currentTime - tab.lastAccessed;
      console.log(`标签页 ${tab.id} (${tab.title}) 未活动时间: ${Math.round(inactiveTime/1000/60)} 分钟`);
      
      if (inactiveTime > INACTIVE_TIMEOUT) {
        // 检查页面是否在编辑状态
        const isEditing = await isTabInEditingState(tab);
        if (isEditing) {
          console.log(`标签页 ${tab.id} (${tab.title}) 正在编辑中，跳过关闭`);
          continue;
        }

        console.log(`准备关闭不活跃标签页: ${tab.title}`);
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
        chrome.tabs.remove(tab.id);
        console.log(`已关闭标签页: ${tab.title}`);
      }
    }
  }
});

// 保存标签页访问时间
async function saveTabTimes() {
  await chrome.storage.local.set({ tabLastAccessed });
}

// 初始化时加载保存的数据并处理已存在的标签页
chrome.runtime.onStartup.addListener(async () => {
  console.log('插件启动...');
  const data = await chrome.storage.local.get('tabLastAccessed');
  tabLastAccessed = data.tabLastAccessed || {};
  await initializeExistingTabs();
});

// 插件安装或更新时也初始化标签页
chrome.runtime.onInstalled.addListener(async () => {
  console.log('插件安装或更新...');
  await initializeExistingTabs();
}); 