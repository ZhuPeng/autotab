document.addEventListener('DOMContentLoaded', async () => {
  // 清除徽章
  chrome.action.setBadgeText({ text: '' });
  
  const { closedTabs = [] } = await chrome.storage.local.get('closedTabs');
  const tabList = document.getElementById('tabList');
  const searchInput = document.getElementById('searchInput');
  
  // 将所有标签页标记为已读（仅在存储中）
  const updatedTabs = closedTabs.map(tab => ({
    ...tab,
    isRead: true
  }));
  await chrome.storage.local.set({ closedTabs: updatedTabs });
  
  // 按URL对标签页进行分组统计，但保持原始的未读状态用于显示
  const tabStats = closedTabs.reduce((acc, tab) => {  // 使用原始的 closedTabs
    if (!acc[tab.url]) {
      acc[tab.url] = {
        title: tab.title,
        url: tab.url,
        count: 1,
        lastClosed: tab.closedAt,
        closedTimes: [tab.closedAt],
        isRead: tab.isRead  // 保持原始的未读状态
      };
    } else {
      acc[tab.url].count++;
      acc[tab.url].closedTimes.push(tab.closedAt);
      if (tab.closedAt > acc[tab.url].lastClosed) {
        acc[tab.url].lastClosed = tab.closedAt;
        acc[tab.url].title = tab.title;
        acc[tab.url].isRead = tab.isRead;  // 保持原始的未读状态
      }
    }
    return acc;
  }, {});
  
  // 转换为数组并按最后关闭时间排序
  const sortedTabs = Object.values(tabStats)
    .sort((a, b) => b.lastClosed - a.lastClosed);

  // 渲染标签页列表
  function renderTabs(tabs) {
    tabList.innerHTML = '';
    
    if (tabs.length === 0) {
      const noResults = document.createElement('div');
      noResults.className = 'no-results';
      noResults.textContent = '没有找到匹配的标签页';
      tabList.appendChild(noResults);
      return;
    }

    tabs.forEach(tab => {
      const tabElement = document.createElement('div');
      tabElement.className = `tab-item${!tab.isRead ? ' unread' : ''}`;
      
      const titleContainer = document.createElement('div');
      titleContainer.className = 'title-container';
      
      const title = document.createElement('div');
      title.className = 'tab-title';
      title.textContent = tab.title;
      
      const count = document.createElement('div');
      count.className = 'tab-count';
      count.textContent = `关闭次数: ${tab.count}`;
      
      titleContainer.appendChild(title);
      titleContainer.appendChild(count);
      
      const url = document.createElement('div');
      url.className = 'tab-url';
      url.textContent = tab.url;
      
      const time = document.createElement('div');
      time.className = 'tab-time';
      time.textContent = `最后关闭: ${new Date(tab.lastClosed).toLocaleString()}`;
      
      tabElement.appendChild(titleContainer);
      tabElement.appendChild(url);
      tabElement.appendChild(time);
      
      tabElement.addEventListener('click', async () => {
        const { closedTabs = [] } = await chrome.storage.local.get('closedTabs');
        const updatedTabs = closedTabs.map(t => {
          if (t.url === tab.url && !t.isRead) {
            return { ...t, isRead: true };
          }
          return t;
        });
        await chrome.storage.local.set({ closedTabs: updatedTabs });
        
        tabElement.classList.remove('unread');
        tab.isRead = true;
        
        chrome.tabs.create({ url: tab.url });
      });
      
      tabList.appendChild(tabElement);
    });
  }

  // 搜索函数
  function searchTabs(query) {
    if (!query) {
      renderTabs(sortedTabs.slice(0, 100));
      return;
    }

    const searchTerms = query.toLowerCase().split(' ').filter(term => term);
    const filteredTabs = sortedTabs.filter(tab => {
      const title = tab.title.toLowerCase();
      const url = tab.url.toLowerCase();
      
      // 所有搜索词都必须匹配标题或URL
      return searchTerms.every(term => 
        title.includes(term) || url.includes(term)
      );
    });

    renderTabs(filteredTabs.slice(0, 100));
  }

  // 添加搜索输入事件监听
  let searchTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      searchTabs(e.target.value.trim());
    }, 300); // 300ms 防抖
  });

  // 初始渲染
  renderTabs(sortedTabs.slice(0, 100));

  // 聚焦搜索框
  searchInput.focus();
}); 