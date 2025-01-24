// 设置自动关闭的时间阈值（毫秒）
const INACTIVE_TIMEOUT = 4 * 60 * 60 * 1000; 
let MAX_TABS = 20; // 默认最大标签页数量
const CheckPeriodInMinutes = 60;

// 存储标签页的最后访问时间
let tabLastAccessed = {};

// 添加新的变量来跟踪最近关闭的标签数
let recentClosedCount = 0;

// 加载用户设置
async function loadSettings() {
  const result = await chrome.storage.sync.get({
    maxTabs: 20 // 默认值
  });
  MAX_TABS = result.maxTabs;
  console.log('========== 加载设置 ==========');
  console.log('最大标签页数量:', MAX_TABS);
  console.log('自动关闭超时时间:', INACTIVE_TIMEOUT/1000/60, '分钟');
  console.log('检查周期:', CheckPeriodInMinutes, '分钟');
  console.log('==============================');
}

// 初始化已打开标签页的访问时间
async function initializeExistingTabs() {
  console.log('========== 初始化标签页 ==========');
  const tabs = await chrome.tabs.query({});
  const currentTime = Date.now();
  
  const activeTab = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTabId = activeTab[0]?.id;
  
  console.log('当前打开的标签页数量:', tabs.length);
  console.log('当前活动的标签页ID:', activeTabId);
  
  const isNewTab = (tab) => {
    return tab.url === 'chrome://newtab/' || 
           tab.url === 'about:blank' ||
           tab.title === 'New Tab' ||
           tab.title === '新标签页';
  };
  
  let newTabCount = 0;
  tabs.forEach(tab => {
    if (isNewTab(tab)) {
      tabLastAccessed[tab.id] = 0;
      newTabCount++;
      console.log(`新标签页: [${tab.id}] ${tab.title}`);
    } else if (tab.id === activeTabId) {
      tabLastAccessed[tab.id] = currentTime;
      console.log(`当前活动标签页: [${tab.id}] ${tab.title}`);
    } else {
      tabLastAccessed[tab.id] = currentTime - (INACTIVE_TIMEOUT / 2);
      console.log(`普通标签页: [${tab.id}] ${tab.title}`);
    }
  });
  
  console.log('新标签页数量:', newTabCount);
  console.log('普通标签页数量:', tabs.length - newTabCount);
  console.log('==============================');
  
  await saveTabTimes();
}

// 监听标签页被激活的事件
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  const isNewTab = tab.url === 'chrome://newtab/' || 
                   tab.url === 'about:blank' ||
                   tab.title === 'New Tab' ||
                   tab.title === '新标签页';
                   
  if (isNewTab) {
    tabLastAccessed[activeInfo.tabId] = 0;
  } else {
    tabLastAccessed[activeInfo.tabId] = Date.now();
  }
  await saveTabTimes();
});

// 监听标签页更新的事件
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    const isNewTab = tab.url === 'chrome://newtab/' || 
                    tab.url === 'about:blank' ||
                    tab.title === 'New Tab' ||
                    tab.title === '新标签页';
                    
    if (isNewTab) {
      tabLastAccessed[tabId] = 0;
    } else {
      tabLastAccessed[tabId] = Date.now();
    }
    saveTabTimes();
  }
});

// 监听标签页关闭的事件
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabLastAccessed[tabId];
  saveTabTimes();
});

// 检查标签页是否在编辑状态
async function isTabInEditingState(tab) {
  try {
    console.log(`\n检查编辑状态: [${tab.id}] ${tab.title}`);
    
    // 检查标题关键词
    const editKeywords = ['编辑', 'edit', '撰写', 'compose', '新建', 'new', '回复', 'reply'];
    if (editKeywords.some(keyword => tab.title.toLowerCase().includes(keyword.toLowerCase()))) {
      console.log(`检测到编辑关键词: ${tab.title}`);
      return true;
    }

    // 注入并执行检查脚本
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // 1. 检查常见编辑器框架
        const editorSelectors = [
          '.monaco-editor', // VS Code 风格编辑器
          '.CodeMirror', // CodeMirror 编辑器
          '.ace_editor', // Ace 编辑器
          '[contenteditable="true"]', // 可编辑内容
          '.ql-editor', // Quill 编辑器
          '.tox-edit-area', // TinyMCE 编辑器
          '.ProseMirror', // ProseMirror 编辑器
          '.fr-element', // Froala 编辑器
          '.trumbowyg-editor', // Trumbowyg 编辑器
          '.note-editable', // Summernote 编辑器
        ];

        if (editorSelectors.some(selector => document.querySelector(selector))) {
          return { reason: 'editor', result: true };
        }

        // 2. 检查表单编辑状态
        const forms = document.forms;
        for (let form of forms) {
          const formInputs = form.querySelectorAll('input, textarea, select');
          for (let input of formInputs) {
            // 检查是否有用户输入的内容
            if (input.value && input.value !== input.defaultValue) {
              return { reason: 'form', result: true };
            }
            // 检查是否处于焦点状态
            if (document.activeElement === input) {
              return { reason: 'focus', result: true };
            }
          }
        }

        // 3. 检查特定网站的编辑状态
        const siteSpecificSelectors = {
          // GitHub
          github: [
            '.js-comment-field', // 评论框
            '.commit-create', // 提交创建
            '.js-code-editor', // 代码编辑器
            '.upload-enabled', // 文件上传区域
            '.js-blob-code' // 文件编辑
          ],
          // Google 系列
          google: [
            '.docs-title-input', // Google Docs
            '.compose-content', // Gmail
            '.cell-input', // Google Sheets
            '.script-editor-textarea' // Google Apps Script
          ],
          // 通用博客/CMS
          cms: [
            '#post-editor',
            '.article-editor',
            '.post-content-editor',
            '.markdown-editor'
          ],
          // 社交媒体
          social: [
            '[aria-label*="编写"]',
            '[aria-label*="write"]',
            '[aria-label*="compose"]',
            '[role="textbox"]'
          ]
        };

        for (const category in siteSpecificSelectors) {
          if (siteSpecificSelectors[category].some(selector => document.querySelector(selector))) {
            return { reason: category, result: true };
          }
        }

        // 4. 检查未保存更改提示
        const unsavedSelectors = [
          '[data-unsaved]',
          '.unsaved-changes',
          '.has-changes',
          '[data-dirty="true"]'
        ];

        if (unsavedSelectors.some(selector => document.querySelector(selector))) {
          return { reason: 'unsaved', result: true };
        }

        // 5. 检查页面 URL 特征
        const editUrlPatterns = [
          '/edit/',
          '/create/',
          '/new/',
          '/compose/',
          '/write/'
        ];

        if (editUrlPatterns.some(pattern => window.location.href.includes(pattern))) {
          return { reason: 'url', result: true };
        }

        return { reason: 'none', result: false };
      }
    });

    const isEditing = results.some(result => result.result === true);
    if (isEditing) {
      const reason = results.find(r => r.result === true)?.reason;
      console.log(`编辑状态检测结果: 是 (${reason})`);
    } else {
      console.log('编辑状态检测结果: 否');
    }
    return isEditing;

  } catch (error) {
    console.log(`编辑状态检测失败:`, error);
    return false;
  }
}

// 定期检查并关闭不活跃的标签页
chrome.alarms.create('checkInactiveTabs', { periodInMinutes: CheckPeriodInMinutes });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'checkInactiveTabs') {
    console.log('\n=============== 开始检查标签页 ===============');
    console.log('检查时间:', new Date().toLocaleString());
    const tabs = await chrome.tabs.query({});
    const currentTime = Date.now();
    
    console.log(`当前标签数: ${tabs.length}/${MAX_TABS}`);
    
    if (tabs.length <= MAX_TABS) {
      console.log('标签数未超过限制，无需关闭');
      console.log('============================================\n');
      return;
    }

    const isNewTab = (tab) => {
      return tab.url === 'chrome://newtab/' || 
             tab.url === 'about:blank' ||
             tab.title === 'New Tab' ||
             tab.title === '新标签页';
    };
    
    const newTabs = tabs.filter(isNewTab);
    const normalTabs = tabs.filter(tab => !isNewTab(tab))
      .map(tab => ({
        ...tab,
        lastAccessed: tabLastAccessed[tab.id] || currentTime
      }))
      .sort((a, b) => a.lastAccessed - b.lastAccessed);

    console.log('\n标签页分类统计:');
    console.log('- 新标签页数量:', newTabs.length);
    console.log('- 普通标签页数量:', normalTabs.length);
    
    const targetCloseCount = tabs.length - MAX_TABS;
    console.log(`\n需要关闭: ${targetCloseCount} 个标签页`);
    
    let closedCount = 0;
    
    // 首先关闭新标签页
    if (newTabs.length > 0) {
      console.log('\n========== 处理新标签页 ==========');
    }
    
    for (const tab of newTabs) {
      if (closedCount >= targetCloseCount) break;
      
      console.log(`\n[关闭新标签页 ${closedCount + 1}/${targetCloseCount}]`);
      console.log(`ID: ${tab.id}`);
      console.log(`标题: ${tab.title}`);
      console.log(`URL: ${tab.url}`);
      
      const closedTab = {
        title: tab.title,
        url: tab.url,
        closedAt: currentTime
      };
      
      const { closedTabs = [] } = await chrome.storage.local.get('closedTabs');
      closedTabs.push(closedTab);
      await chrome.storage.local.set({ closedTabs });
      
      await chrome.tabs.remove(tab.id);
      closedCount++;
      recentClosedCount++;
      updateBadge(recentClosedCount);
    }
    
    // 处理普通标签页
    if (closedCount < targetCloseCount) {
      console.log('\n========== 处理普通标签页 ==========');
    }
    
    let checkedCount = 0;
    while (closedCount < targetCloseCount && checkedCount < normalTabs.length) {
      const tab = normalTabs[checkedCount];
      const inactiveTime = currentTime - tab.lastAccessed;
      const inactiveMinutes = Math.round(inactiveTime/1000/60);
      
      console.log(`\n[检查标签页 ${checkedCount + 1}/${normalTabs.length}]`);
      console.log(`ID: ${tab.id}`);
      console.log(`标题: ${tab.title}`);
      console.log(`URL: ${tab.url}`);
      console.log(`未活动时间: ${inactiveMinutes} 分钟`);
      
      if (inactiveTime > INACTIVE_TIMEOUT) {
        const isEditing = await isTabInEditingState(tab);
        if (isEditing) {
          console.log(`结果: 跳过（正在编辑）`);
          checkedCount++;
          continue;
        }

        console.log(`结果: 关闭（超时未使用）`);
        const closedTab = {
          title: tab.title,
          url: tab.url,
          closedAt: currentTime
        };
        
        const { closedTabs = [] } = await chrome.storage.local.get('closedTabs');
        closedTabs.push(closedTab);
        await chrome.storage.local.set({ closedTabs });
        
        await chrome.tabs.remove(tab.id);
        closedCount++;
        recentClosedCount++;
        updateBadge(recentClosedCount);
      } else {
        console.log(`结果: 保留（活跃中）`);
      }
      checkedCount++;
    }
    
    console.log('\n========== 检查结果 ==========');
    console.log(`已关闭: ${closedCount} 个标签页`);
    if (closedCount < targetCloseCount) {
      console.log(`未完成目标: 还有 ${targetCloseCount - closedCount} 个标签页因为活跃或正在编辑而无法关闭`);
    } else {
      console.log('已达到目标关闭数量');
    }
    console.log('============================================\n');
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
    console.log('\n========== 设置已更新 ==========');
    console.log('最大标签页数量:', MAX_TABS);
    console.log('==============================');
  }
});

// 初始化时加载保存的数据并处理已存在的标签页
chrome.runtime.onStartup.addListener(async () => {
  console.log('插件启动...');
  await loadSettings();
  const data = await chrome.storage.local.get('tabLastAccessed');
  tabLastAccessed = data.tabLastAccessed || {};
  await initializeExistingTabs();
  recentClosedCount = 0;
  updateBadge(0);
});

// 插件安装或更新时也初始化标签页
chrome.runtime.onInstalled.addListener(async () => {
  console.log('插件安装或更新...');
  await loadSettings();
  await initializeExistingTabs();
  recentClosedCount = 0;
  updateBadge(0);
});

// 更新图标上的提示标记
function updateBadge(count) {
  if (count > 0) {
    // 设置红色背景
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
    // 设置显示的数字
    chrome.action.setBadgeText({ text: count.toString() });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
} 