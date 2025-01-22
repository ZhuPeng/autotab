document.addEventListener('DOMContentLoaded', async () => {
  const { closedTabs = [] } = await chrome.storage.local.get('closedTabs');
  const tabList = document.getElementById('tabList');
  
  // 按URL对标签页进行分组统计
  const tabStats = closedTabs.reduce((acc, tab) => {
    if (!acc[tab.url]) {
      acc[tab.url] = {
        title: tab.title,
        url: tab.url,
        count: 1,
        lastClosed: tab.closedAt,
        closedTimes: [tab.closedAt]
      };
    } else {
      acc[tab.url].count++;
      acc[tab.url].closedTimes.push(tab.closedAt);
      if (tab.closedAt > acc[tab.url].lastClosed) {
        acc[tab.url].lastClosed = tab.closedAt;
        acc[tab.url].title = tab.title; // 使用最新的标题
      }
    }
    return acc;
  }, {});
  
  // 转换为数组并按最后关闭时间排序
  const sortedTabs = Object.values(tabStats)
    .sort((a, b) => b.lastClosed - a.lastClosed);
  
  // 显示最近100个不同的URL
  sortedTabs.slice(0, 100).forEach(tab => {
    const tabElement = document.createElement('div');
    tabElement.className = 'tab-item';
    
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
    
    // 点击标签项时打开链接
    tabElement.addEventListener('click', () => {
      chrome.tabs.create({ url: tab.url });
    });
    
    tabList.appendChild(tabElement);
  });
}); 