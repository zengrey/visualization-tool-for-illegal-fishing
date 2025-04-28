// 定义图谱颜色方案
const nodeColors = {
    'organization': '#e74c3c',
    'person': '#3498db',
    'vessel': '#2ecc71',
    'location': '#f39c12',
    'event': '#9b59b6'
};

// 全局变量
let graph;
let simulation;
let svg;
let link;
let node;
let width;
let height;
let zoom;
let nodeMap = new Map();
let selectedNode = null;
let highlightedNodes = new Set();
let highlightedLinks = new Set();
let suspectEntities = [
    "Mar de la Vida OJSC",
    "979893388",
    "Oceanfront Oasis Inc Carriers",
    "8327"
];

// PCA相关变量
let pcaData = {};
let pcaSvg;
let pcaWidth = 300;
let pcaHeight = 300;
let pcaPoints;
let pcaSelectedPoint = null;
let visibleNodeIds = new Set(); // 用于跟踪在主图中显示的节点ID

// 主函数：加载数据并初始化图表
async function init() {
    try {
        // 显示加载提示
        document.getElementById('loading').textContent = 'Loading data...';
        
        // 加载数据
        graph = await d3.json('MC1_cleaned.json');
        
        // 加载PCA数据
        try {
            pcaData = await d3.json('MC1_out_vessel_pca.json');
            console.log('PCA data loaded successfully:', Object.keys(pcaData).length, 'coordinate points');
        } catch (pcaError) {
            console.error('Failed to load PCA data:', pcaError);
            pcaData = {};
        }
        
        // 处理数据
        processData();
        
        // 创建节点Map用于快速查找
        graph.nodes.forEach(n => {
            nodeMap.set(n.id, n);
        });
        
        // 设置画布尺寸
        const container = document.getElementById('graph');
        width = container.clientWidth;
        height = container.clientHeight;
        
        // 移除加载提示
        document.getElementById('loading').style.display = 'none';
        
        // 初始化图表
        initGraph();
        
        // 初始化PCA散点图
        initPcaPlot();
        
        // 初始化平均分布
        updateMeanDistribution();
        
        // 设置事件监听
        setupEventListeners();
    } catch (error) {
        console.error('Error loading data:', error);
        document.getElementById('loading').textContent = 'Failed to load data, please check your network connection and refresh the page. Error: ' + error.message;
    }
}

// 处理数据以适应D3.js力导向图
function processData() {
    console.log("Processing data...");
    console.log("Original graph structure:", Object.keys(graph));
    
    // 确保节点数据存在
    if (!graph.nodes) {
        console.error("No nodes found in data");
        throw new Error("Data format error: No nodes found");
    }
    
    // 确保连接数据存在，如果不存在则尝试从其他属性中获取
    if (!graph.links && graph.edges) {
        graph.links = graph.edges;
        console.log("Using 'edges' as 'links'");
    } else if (!graph.links) {
        // 如果既没有links也没有edges，创建一个空数组
        console.error("No links/edges found in data");
        graph.links = [];
    }
    
    console.log(`Found ${graph.nodes.length} nodes and ${graph.links.length} links`);
    
    // 对节点数据进行扩充
    graph.nodes.forEach(node => {
        // 确保每个节点都有类型，如果没有则设为"unknown"
        if (!node.type) {
            node.type = "unknown";
        }
    });
    
    // 处理连接数据，确保source和target是对象引用而不是ID
    graph.links.forEach(link => {
        // 如果source和target是字符串ID，则转换为对象引用
        if (typeof link.source === 'string' || typeof link.source === 'number') {
            const sourceNode = graph.nodes.find(n => n.id === link.source);
            if (sourceNode) {
                link.source = sourceNode;
            }
        }
        
        if (typeof link.target === 'string' || typeof link.target === 'number') {
            const targetNode = graph.nodes.find(n => n.id === link.target);
            if (targetNode) {
                link.target = targetNode;
            }
        }
        
        // 确保每个连接都有值，如果没有则默认为1
        if (!link.value) {
            link.value = 1;
        }
    });
    
    // 如果是有向图的处理（VAST挑战中的图通常是有向的）
    if (graph.directed) {
        console.log("This is a directed graph");
    }
    
    // 如果需要，删除无效的连接（source或target不存在）
    graph.links = graph.links.filter(link => 
        typeof link.source === 'object' && 
        typeof link.target === 'object' && 
        link.source && 
        link.target
    );
    
    console.log(`After processing: ${graph.nodes.length} nodes and ${graph.links.length} valid links`);
}

// 初始化图表
function initGraph() {
    // 缩放行为
    zoom = d3.zoom()
        .scaleExtent([0.1, 8])
        .on('zoom', (event) => {
            g.attr('transform', event.transform);
        });
    
    // 创建SVG
    svg = d3.select('#graph')
        .append('svg')
        .attr('width', '100%')
        .attr('height', '100%')
        .call(zoom);
    
    // 创建一个g元素作为所有元素的容器
    const g = svg.append('g');
    
    // 定义箭头标记
    svg.append('defs').append('marker')
        .attr('id', 'arrowhead')
        .attr('viewBox', '-0 -5 10 10')
        .attr('refX', 20)
        .attr('refY', 0)
        .attr('orient', 'auto')
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('xoverflow', 'visible')
        .append('svg:path')
        .attr('d', 'M 0,-5 L 10 ,0 L 0,5')
        .attr('fill', '#999')
        .style('stroke', 'none');
    
    // 首先，提取出关键的可疑实体和它们的一阶关系
    // 这样可以减少渲染的节点数，提高性能
    const keyEntities = new Set(suspectEntities);
    const importantNodes = new Set();
    const importantLinks = [];
    
    // 添加可疑实体
    suspectEntities.forEach(id => {
        const node = graph.nodes.find(n => n.id === id);
        if (node) {
            importantNodes.add(node);
        }
    });
    
    // 添加与可疑实体有直接关联的节点和连接
    graph.links.forEach(link => {
        if (keyEntities.has(link.source.id) || keyEntities.has(link.target.id)) {
            importantNodes.add(link.source);
            importantNodes.add(link.target);
            importantLinks.push(link);
        }
    });
    
    // 如果重要节点太少，可能是上一步没找到足够的连接
    // 在这种情况下，我们可以添加更多的节点
    if (importantNodes.size < 50) {
        // 为已找到的重要节点添加二阶连接
        const secondaryEntities = new Set();
        importantNodes.forEach(node => secondaryEntities.add(node.id));
        
        graph.links.forEach(link => {
            if (secondaryEntities.has(link.source.id) || secondaryEntities.has(link.target.id)) {
                importantNodes.add(link.source);
                importantNodes.add(link.target);
                if (!importantLinks.includes(link)) {
                    importantLinks.push(link);
                }
            }
        });
    }
    
    // 转换集合为数组
    const nodesToRender = Array.from(importantNodes);
    const linksToRender = importantLinks;
    
    console.log(`Rendering ${nodesToRender.length} nodes and ${linksToRender.length} links`);
    
    // 创建连接线
    link = g.append('g')
        .attr('class', 'links')
        .selectAll('line')
        .data(linksToRender)
        .enter()
        .append('line')
        .attr('stroke', '#999')
        .attr('stroke-width', d => Math.sqrt(d.value || 1))
        .attr('marker-end', 'url(#arrowhead)')
        .attr('class', 'link');
    
    // 创建节点
    node = g.append('g')
        .attr('class', 'nodes')
        .selectAll('circle')
        .data(nodesToRender)
        .enter()
        .append('circle')
        .attr('r', d => suspectEntities.includes(d.id) ? 10 : 5)
        .attr('fill', d => nodeColors[d.type] || '#999')
        .attr('stroke', d => suspectEntities.includes(d.id) ? '#000' : '#fff')
        .attr('stroke-width', d => suspectEntities.includes(d.id) ? 2 : 1)
        .attr('class', 'node')
        .call(d3.drag()
            .on('start', dragStarted)
            .on('drag', dragged)
            .on('end', dragEnded));
    
    // 添加悬停时的标题提示
    node.append('title')
        .text(d => d.id);
    
    // 创建力导向模拟
    simulation = d3.forceSimulation()
        .nodes(nodesToRender)
        .force('link', d3.forceLink(linksToRender).id(d => d.id).distance(100))
        .force('charge', d3.forceManyBody().strength(-100))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(10))
        .on('tick', ticked);
    
    // 自动居中首次显示
    svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(0.5));
    
    // 更新PCA散点图，显示主图中的节点
    updatePcaPlot();
}

// 每次tick的更新函数
function ticked() {
    link
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);
    
    node
        .attr('cx', d => d.x)
        .attr('cy', d => d.y);
}

// 拖拽开始事件
function dragStarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
}

// 拖拽中事件
function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
}

// 拖拽结束事件
function dragEnded(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
}

// 设置事件监听
function setupEventListeners() {
    // 搜索按钮点击事件
    document.getElementById('search-btn').addEventListener('click', searchEntity);
    
    // 搜索输入框回车事件
    document.getElementById('search-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchEntity();
        }
    });
    
    // 实体类型筛选器变化事件
    document.querySelectorAll('.filter-group input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', applyFilters);
    });
    
    // 疑似实体按钮点击事件
    document.getElementById('suspect-1').addEventListener('click', () => highlightSuspect("Mar de la Vida OJSC"));
    document.getElementById('suspect-2').addEventListener('click', () => highlightSuspect("979893388"));
    document.getElementById('suspect-3').addEventListener('click', () => highlightSuspect("Oceanfront Oasis Inc Carriers"));
    document.getElementById('suspect-4').addEventListener('click', () => highlightSuspect("8327"));
    
    // 节点点击事件
    node.on('click', nodeClicked);
    
    // 节点悬停事件
    node.on('mouseover', nodeMouseOver)
        .on('mouseout', nodeMouseOut);
}

// 节点点击事件处理
function nodeClicked(event, d) {
    selectedNode = d;
    updateEntityInfo(d);
    highlightNodeAndConnections(d);
    updateConnectionTypeDistribution(d);
}

// 节点鼠标悬停事件
function nodeMouseOver(event, d) {
    // 显示提示框
    const tooltip = document.getElementById('tooltip');
    tooltip.style.display = 'block';
    tooltip.style.left = (event.pageX + 10) + 'px';
    tooltip.style.top = (event.pageY + 10) + 'px';
    
    // 生成提示内容
    let content = `<strong>ID:</strong> ${d.id}<br>`;
    content += `<strong>Type:</strong> ${translateType(d.type)}<br>`;
    
    if (d.country) {
        content += `<strong>Country:</strong> ${d.country}<br>`;
    }
    
    // 计算连接数
    const connections = countConnections(d);
    content += `<strong>Connections:</strong> ${connections}`;
    
    tooltip.innerHTML = content;
}

// 节点鼠标移出事件
function nodeMouseOut() {
    document.getElementById('tooltip').style.display = 'none';
}

// 搜索实体
function searchEntity() {
    const searchTerm = document.getElementById('search-input').value.trim();
    
    if (!searchTerm) return;
    
    // 从当前渲染的节点中查找匹配的
    const matchNodes = node.data().filter(n => 
        n.id.toLowerCase().includes(searchTerm.toLowerCase()));
    
    if (matchNodes.length > 0) {
        // 选择第一个匹配的节点
        const targetNode = matchNodes[0];
        
        // 居中并放大该节点
        centerOnNode(targetNode);
        
        // 高亮节点及其连接
        highlightNodeAndConnections(targetNode);
        
        // 更新信息面板
        updateEntityInfo(targetNode);
    } else {
        alert('No matching entity found');
    }
}

// 高亮可疑实体
function highlightSuspect(id) {
    // Clear previous highlights
    clearHighlights();
    
    // Find the node
    const node = graph.nodes.find(n => n.id === id);
    if (node) {
        // Center on the node
        centerOnNode(node);
        
        // Highlight the node and its connections
        highlightNodeAndConnections(node);
        
        // Update connection type distribution
        updateConnectionTypeDistribution(node);
        
        // Update entity info
        updateEntityInfo(node);
    }
}

// 高亮节点及其连接
function highlightNodeAndConnections(d) {
    // 清除之前的高亮
    clearHighlights();
    
    // 添加点击的节点到高亮集合
    highlightedNodes.add(d.id);
    
    // 查找直接相连的节点和连接
    // 注意我们需要操作渲染的连接数据，而不是原始数据
    link.each(function(l) {
        if ((l.source.id === d.id) || (l.target.id === d.id)) {
            // 将连接的节点添加到高亮集合
            if (l.source.id === d.id) {
                highlightedNodes.add(l.target.id);
            } else {
                highlightedNodes.add(l.source.id);
            }
            
            // 将连接添加到高亮集合
            highlightedLinks.add(l);
        }
    });
    
    // 应用高亮样式
    applyHighlights();
    
    // 更新PCA散点图的高亮状态
    updatePcaHighlight();
}

// 清除所有高亮
function clearHighlights() {
    highlightedNodes.clear();
    highlightedLinks.clear();
    
    // 重置所有节点和连接的样式
    node.attr('opacity', 1)
        .attr('stroke', d => suspectEntities.includes(d.id) ? '#000' : '#fff')
        .attr('stroke-width', d => suspectEntities.includes(d.id) ? 2 : 1);
    
    link.attr('opacity', 0.6)
        .attr('stroke', '#999')
        .attr('stroke-width', d => Math.sqrt(d.value || 1));
    
    // 更新PCA散点图中所有点的样式
    updatePcaHighlight();
}

// 应用高亮样式
function applyHighlights() {
    // 如果没有高亮的节点，则不做任何更改
    if (highlightedNodes.size === 0) return;
    
    // 设置所有节点和连接为低透明度
    node.attr('opacity', d => highlightedNodes.has(d.id) ? 1 : 0.1);
    link.attr('opacity', l => highlightedLinks.has(l) ? 1 : 0.05);
    
    // 增加高亮连接的宽度和颜色
    link.attr('stroke', l => highlightedLinks.has(l) ? '#ff5722' : '#999')
        .attr('stroke-width', l => highlightedLinks.has(l) ? 2 * Math.sqrt(l.value || 1) : Math.sqrt(l.value || 1));
}

// 应用筛选器
function applyFilters() {
    // 获取所有选中的类型
    const showOrg = document.getElementById('filter-org').checked;
    const showPerson = document.getElementById('filter-person').checked;
    const showVessel = document.getElementById('filter-vessel').checked;
    const showLocation = document.getElementById('filter-location').checked;
    const showEvent = document.getElementById('filter-event').checked;
    
    // 应用筛选
    node.attr('display', d => {
        if (d.type === 'organization' && !showOrg) return 'none';
        if (d.type === 'person' && !showPerson) return 'none';
        if (d.type === 'vessel' && !showVessel) return 'none';
        if (d.type === 'location' && !showLocation) return 'none';
        if (d.type === 'event' && !showEvent) return 'none';
        return null;
    });
    
    // 更新连接的可见性
    link.attr('display', l => {
        const sourceVisible = isNodeVisible(l.source);
        const targetVisible = isNodeVisible(l.target);
        
        return sourceVisible && targetVisible ? null : 'none';
    });
    
    // 立即更新节点可见性数据
    node.each(function(d) {
        d.isVisible = d3.select(this).attr('display') !== 'none';
    });
    
    // 更新PCA散点图，只显示筛选后可见的节点
    setTimeout(updatePcaPlot, 10);
}

// 检查节点是否可见
function isNodeVisible(node) {
    if (node.type === 'organization' && !document.getElementById('filter-org').checked) return false;
    if (node.type === 'person' && !document.getElementById('filter-person').checked) return false;
    if (node.type === 'vessel' && !document.getElementById('filter-vessel').checked) return false;
    if (node.type === 'location' && !document.getElementById('filter-location').checked) return false;
    if (node.type === 'event' && !document.getElementById('filter-event').checked) return false;
    return true;
}

// 居中到指定节点
function centerOnNode(node) {
    // 计算缩放和平移
    const scale = 1.5;
    const x = -node.x * scale + width / 2;
    const y = -node.y * scale + height / 2;
    
    // 应用变换
    svg.transition()
        .duration(750)
        .call(zoom.transform, d3.zoomIdentity.translate(x, y).scale(scale));
}

// 更新实体信息面板
function updateEntityInfo(d) {
    const infoPanel = document.getElementById('entity-info');
    
    // 计算连接数
    const connections = countConnections(d);
    
    // 生成风险评分 (示例算法)
    const riskScore = calculateRiskScore(d, connections);
    
    // 组装信息HTML
    let html = `<h3>${d.id}</h3>`;
    html += `<p><strong>Type:</strong> ${translateType(d.type)}</p>`;
    
    if (d.country) {
        html += `<p><strong>Country:</strong> ${d.country}</p>`;
    }
    
    html += `<p><strong>Connections:</strong> ${connections}</p>`;
    html += `<p><strong>Risk Score:</strong> <span style="color: ${getRiskColor(riskScore)};">${riskScore}/10</span></p>`;
    
    // 添加风险评估
    html += `<p><strong>Risk Assessment:</strong> ${getRiskAssessment(d, riskScore)}</p>`;
    
    infoPanel.innerHTML = html;
}

// 统计节点的连接数
function countConnections(node) {
    let count = 0;
    
    // 使用渲染的连接数据计算
    link.each(function(l) {
        if (l.source.id === node.id || l.target.id === node.id) {
            count++;
        }
    });
    
    return count;
}

// 计算风险评分 (示例算法)
function calculateRiskScore(node, connections) {
    let score = 0;
    
    // Base score based on connection count (degree)
    score += Math.min(connections * 0.3, 3); // Max 3 points
    
    // Node type contribution
    if (node.type === 'vessel') {
        score += 2; // High risk due to potential illicit transport
    } else if (node.type === 'organization') {
        score += 1; // Moderate risk for structured entities
    } else if (node.type === 'person') {
        score += 0.5; // Lower risk unless suspicious
    }
    
    // Check for connections to vessels (high risk)
    let vesselConnections = 0;
    graph.links.forEach(link => {
        if ((link.source.id === node.id || link.target.id === node.id) && 
            (link.source.type === 'vessel' || link.target.type === 'vessel')) {
            vesselConnections++;
        }
    });
    
    // Add risk score for vessel connections
    score += Math.min(vesselConnections * 0.5, 2); // Max 2 points for vessel connections
    
    // Check for connections to organizations (moderate risk)
    let orgConnections = 0;
    graph.links.forEach(link => {
        if ((link.source.id === node.id || link.target.id === node.id) && 
            (link.source.type === 'organization' || link.target.type === 'organization')) {
            orgConnections++;
        }
    });
    
    // Add risk score for organization connections
    score += Math.min(orgConnections * 0.3, 1.5); // Max 1.5 points for org connections
    
    // Suspicious entity detection
    const isSuspicious = connections > 10 || vesselConnections > 3;
    if (isSuspicious) {
        score += 3; // High risk for highly connected nodes or many vessel connections
    }
    
    // Normalize score to 0-10 range
    score = Math.min(Math.max(score, 0), 10);
    
    return score;
}

// 获取风险颜色
function getRiskColor(score) {
    if (score >= 7) return '#e74c3c'; // 高风险
    if (score >= 4) return '#f39c12'; // 中风险
    return '#2ecc71'; // 低风险
}

// 生成风险评估文本
function getRiskAssessment(node, score) {
    if (score >= 7) {
        return 'High risk. Strongly recommend further investigation.';
    } else if (score >= 4) {
        return 'Medium risk. Suggest continuous monitoring.';
    } else {
        return 'Low risk. No obvious suspicious activity.';
    }
}

// 类型名称翻译
function translateType(type) {
    const typeMap = {
        'organization': 'Organization',
        'person': 'Person',
        'vessel': 'Vessel',
        'location': 'Location',
        'event': 'Event'
    };
    
    return typeMap[type] || type;
}

// 初始化PCA散点图
function initPcaPlot() {
    // 如果没有PCA数据，不绘制散点图
    if (Object.keys(pcaData).length === 0) {
        console.warn('No PCA data available, skipping scatter plot');
        document.getElementById('pca-plot').style.display = 'none';
        return;
    }
    
    // 获取容器
    const pcaContainer = document.getElementById('pca-plot');
    
    // 创建SVG
    pcaSvg = d3.select('#pca-plot')
        .append('svg')
        .attr('width', pcaWidth)
        .attr('height', pcaHeight);
    
    // 创建一个g元素作为所有点的容器
    const pcaG = pcaSvg.append('g');
    
    // 提取所有PCA坐标点
    const pcaPoints = [];
    const pcaXValues = [];
    const pcaYValues = [];
    
    Object.entries(pcaData).forEach(([id, coords]) => {
        pcaPoints.push({
            id: id,
            x: coords[0],
            y: coords[1]
        });
        pcaXValues.push(coords[0]);
        pcaYValues.push(coords[1]);
    });
    
    // 计算数据的范围，用于缩放
    const xExtent = d3.extent(pcaXValues);
    const yExtent = d3.extent(pcaYValues);
    
    // 创建比例尺
    const xScale = d3.scaleLinear()
        .domain(xExtent)
        .range([20, pcaWidth - 20]);
    
    const yScale = d3.scaleLinear()
        .domain(yExtent)
        .range([pcaHeight - 20, 20]);
    
    // 仅绘制主图中显示的节点
    updatePcaPlot();
}

// 更新PCA散点图，只显示主图中的节点
function updatePcaPlot() {
    // 如果没有PCA数据，直接返回
    if (!pcaSvg || Object.keys(pcaData).length === 0) return;
    
    // 提取所有可见节点的ID
    visibleNodeIds.clear();
    
    // 获取主图中所有可见的节点
    const visibleNodes = [];
    node.each(function(d) {
        const isVisible = d3.select(this).attr('display') !== 'none';
        if (isVisible && pcaData[d.id]) {
            visibleNodeIds.add(d.id);
            visibleNodes.push(d);
        }
    });
    
    console.log("Visible nodes count:", visibleNodeIds.size);
    
    // 准备散点图数据
    const visiblePcaPoints = [];
    
    // 仅包含在主图中可见的节点
    for (const nodeData of visibleNodes) {
        if (pcaData[nodeData.id]) {
            visiblePcaPoints.push({
                id: nodeData.id,
                x: pcaData[nodeData.id][0],
                y: pcaData[nodeData.id][1],
                type: nodeData.type || 'unknown',
                node: nodeData // 保存对原始节点的引用
            });
        }
    }
    
    console.log("PCA visible points count:", visiblePcaPoints.length);
    
    // 如果没有可见点，不绘制
    if (visiblePcaPoints.length === 0) {
        pcaSvg.selectAll('*').remove();
        pcaSvg.append('text')
            .attr('x', pcaWidth / 2)
            .attr('y', pcaHeight / 2)
            .attr('text-anchor', 'middle')
            .attr('font-size', '12px')
            .text('No nodes to display in current view');
        return;
    }
    
    // 计算数据的范围，用于缩放
    const xValues = visiblePcaPoints.map(d => d.x);
    const yValues = visiblePcaPoints.map(d => d.y);
    
    const xExtent = d3.extent(xValues);
    const yExtent = d3.extent(yValues);
    
    // 添加一些边距，防止点被遮挡
    const xMargin = (xExtent[1] - xExtent[0]) * 0.1;
    const yMargin = (yExtent[1] - yExtent[0]) * 0.1;
    
    // 创建比例尺
    const xScale = d3.scaleLinear()
        .domain([xExtent[0] - xMargin, xExtent[1] + xMargin])
        .range([40, pcaWidth - 20]);
    
    const yScale = d3.scaleLinear()
        .domain([yExtent[0] - yMargin, yExtent[1] + yMargin])
        .range([pcaHeight - 40, 20]);
    
    // 清除之前的所有元素
    pcaSvg.selectAll('*').remove();
    
    // 创建坐标轴
    const xAxis = d3.axisBottom(xScale).ticks(5).tickSize(-pcaHeight + 60);
    const yAxis = d3.axisLeft(yScale).ticks(5).tickSize(-pcaWidth + 60);
    
    // 添加X轴
    pcaSvg.append('g')
        .attr('class', 'axis x-axis')
        .attr('transform', `translate(0, ${pcaHeight - 40})`)
        .call(xAxis)
        .selectAll('text')
        .attr('font-size', '8px');
    
    // 添加Y轴
    pcaSvg.append('g')
        .attr('class', 'axis y-axis')
        .attr('transform', `translate(40, 0)`)
        .call(yAxis)
        .selectAll('text')
        .attr('font-size', '8px');
    
    // 添加轴标签
    pcaSvg.append('text')
        .attr('class', 'axis-label')
        .attr('x', pcaWidth / 2)
        .attr('y', pcaHeight - 10)
        .attr('text-anchor', 'middle')
        .attr('font-size', '10px')
        .text('Principal Component 1');
    
    pcaSvg.append('text')
        .attr('class', 'axis-label')
        .attr('transform', 'rotate(-90)')
        .attr('x', -pcaHeight / 2)
        .attr('y', 10)
        .attr('text-anchor', 'middle')
        .attr('font-size', '10px')
        .text('Principal Component 2');
    
    // 添加网格样式
    pcaSvg.selectAll('.axis line')
        .attr('stroke', '#e0e0e0')
        .attr('stroke-dasharray', '2,2');
    
    pcaSvg.selectAll('.axis path')
        .attr('stroke', '#e0e0e0');
    
    // 绘制新的点
    pcaPoints = pcaSvg.append('g')
        .attr('class', 'points')
        .selectAll('.pca-point')
        .data(visiblePcaPoints, d => d.id)
        .enter()
        .append('circle')
        .attr('class', 'pca-point')
        .attr('cx', d => xScale(d.x))
        .attr('cy', d => yScale(d.y))
        .attr('r', d => highlightedNodes.has(d.id) ? 5 : 3)
        .attr('fill', d => nodeColors[d.type] || '#999')
        .attr('stroke', d => highlightedNodes.has(d.id) ? '#000' : 'none')
        .attr('stroke-width', 1)
        .attr('opacity', d => highlightedNodes.size > 0 ? (highlightedNodes.has(d.id) ? 1 : 0.3) : 1)
        .attr('data-id', d => d.id) // 添加数据属性以便调试
        .style('cursor', 'pointer')
        .on('mouseover', pcaPointMouseOver)
        .on('mouseout', pcaPointMouseOut)
        .on('click', pcaPointClicked);
    
    // 添加调试信息（可选）
    console.log("Node type distribution:", 
        visiblePcaPoints.reduce((acc, d) => {
            acc[d.type] = (acc[d.type] || 0) + 1;
            return acc;
        }, {})
    );
}

// PCA点的鼠标悬停事件
function pcaPointMouseOver(event, d) {
    // 显示提示框
    const tooltip = document.getElementById('tooltip');
    tooltip.style.display = 'block';
    tooltip.style.left = (event.pageX + 10) + 'px';
    tooltip.style.top = (event.pageY + 10) + 'px';
    
    // 获取节点详细信息
    const nodeInfo = nodeMap.get(d.id);
    
    // 生成提示内容
    let content = `<strong>ID:</strong> ${d.id}<br>`;
    
    if (nodeInfo) {
        content += `<strong>Type:</strong> ${translateType(nodeInfo.type)}<br>`;
        
        if (nodeInfo.country) {
            content += `<strong>Country:</strong> ${nodeInfo.country}<br>`;
        }
    }
    
    tooltip.innerHTML = content;
    
    // 高亮对应的点
    d3.select(event.target)
        .attr('r', 6)
        .attr('stroke', '#000')
        .attr('stroke-width', 2);
}

// PCA点的鼠标移出事件
function pcaPointMouseOut(event, d) {
    document.getElementById('tooltip').style.display = 'none';
    
    // 恢复点的样式
    if (!highlightedNodes.has(d.id)) {
        d3.select(event.target)
            .attr('r', 3)
            .attr('stroke', 'none');
    }
}

// PCA点的点击事件
function pcaPointClicked(event, d) {
    // Find the corresponding node in the main graph
    const node = graph.nodes.find(n => n.id === d.id);
    if (node) {
        // Center on the node
        centerOnNode(node);
        
        // Highlight the node and its connections
        highlightNodeAndConnections(node);
        
        // Update connection type distribution
        updateConnectionTypeDistribution(node);
        
        // Update entity info
        updateEntityInfo(node);
    }
}

// 更新PCA高亮状态
function updatePcaHighlight() {
    if (!pcaSvg || Object.keys(pcaData).length === 0) return;
    
    // 获取所有PCA点
    const points = pcaSvg.selectAll('.pca-point');
    if (points.empty()) return;
    
    // 更新每个点的样式
    points.each(function(d) {
        const point = d3.select(this);
        const isHighlighted = highlightedNodes.has(d.id);
        
        // 更新样式
        point
            .attr('r', isHighlighted ? 5 : 3)
            .attr('stroke', isHighlighted ? '#000' : 'none')
            .attr('stroke-width', isHighlighted ? 2 : 1)
            .attr('opacity', highlightedNodes.size > 0 ? (isHighlighted ? 1 : 0.3) : 1);
    });
    
    // 如果有高亮节点，将高亮的点移到前面以避免被其他点遮挡
    if (highlightedNodes.size > 0) {
        points.sort((a, b) => {
            const aHighlighted = highlightedNodes.has(a.id) ? 1 : 0;
            const bHighlighted = highlightedNodes.has(b.id) ? 1 : 0;
            return aHighlighted - bHighlighted;
        });
    }
}

function calculateMeanDistribution() {
    // Initialize counters for total connections of each type
    const totalTypeCounts = {
        'organization': 0,
        'person': 0,
        'vessel': 0,
        'location': 0,
        'event': 0
    };
    
    // Count total connections for each type
    graph.links.forEach(link => {
        const sourceType = link.source.type;
        const targetType = link.target.type;
        
        // Count connections for both source and target nodes
        totalTypeCounts[sourceType]++;
        totalTypeCounts[targetType]++;
    });
    
    // Calculate mean by dividing by total number of nodes
    const totalNodes = graph.nodes.length;
    const meanCounts = {};
    Object.entries(totalTypeCounts).forEach(([type, count]) => {
        meanCounts[type] = count / totalNodes;
    });
    
    return meanCounts;
}

function updateMeanDistribution() {
    const meanCounts = calculateMeanDistribution();
    
    // Clear previous chart
    d3.select("#mean-chart").selectAll("*").remove();
    
    // Calculate total mean connections
    const totalMeanConnections = Object.values(meanCounts).reduce((a, b) => a + b, 0);
    
    // Prepare data for the chart
    const data = Object.entries(meanCounts).map(([type, count]) => ({
        type: type,
        count: count
    }));
    
    // Set up the chart dimensions
    const margin = {top: 20, right: 20, bottom: 60, left: 40};
    const width = 260 - margin.left - margin.right;
    const height = 220 - margin.top - margin.bottom;
    
    // Create SVG
    const svg = d3.select("#mean-chart")
        .append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);
    
    // Create scales
    const x = d3.scaleBand()
        .range([0, width])
        .domain(data.map(d => d.type))
        .padding(0.1);
        
    const y = d3.scaleLinear()
        .range([height, 0])
        .domain([0, d3.max(data, d => d.count) * 1.1]);
    
    // Add bars
    svg.selectAll(".bar")
        .data(data)
        .enter().append("rect")
        .attr("class", "bar")
        .attr("x", d => x(d.type))
        .attr("width", x.bandwidth())
        .attr("y", d => y(d.count))
        .attr("height", d => height - y(d.count))
        .attr("fill", d => nodeColors[d.type])
        .attr("opacity", 0.8);
    
    // Add value labels
    svg.selectAll(".value-label")
        .data(data)
        .enter().append("text")
        .attr("class", "value-label")
        .attr("x", d => x(d.type) + x.bandwidth()/2)
        .attr("y", d => y(d.count) - 5)
        .attr("text-anchor", "middle")
        .style("fill", "black")
        .text(d => d.count.toFixed(2));
    
    // Add total mean connections label at the bottom
    svg.append("text")
        .attr("class", "total-label")
        .attr("x", width/2)
        .attr("y", height + margin.bottom - 5)
        .attr("text-anchor", "middle")
        .style("fill", "black")
        .style("font-size", "12px")
        .text(`Average Connections per Node: ${totalMeanConnections.toFixed(2)}`);
    
    // Add axes with more space for labels
    const xAxis = svg.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(x));
    
    // Rotate and adjust labels
    xAxis.selectAll("text")
        .attr("class", "type-label")
        .attr("transform", "rotate(-45)")
        .style("text-anchor", "end")
        .attr("dy", "1em");
        
    svg.append("g")
        .call(d3.axisLeft(y));
}

function updateConnectionTypeDistribution(node) {
    // Clear previous chart
    d3.select("#connection-chart").selectAll("*").remove();
    
    // Count connections by type
    const connectionCounts = {
        'organization': 0,
        'person': 0,
        'vessel': 0,
        'location': 0,
        'event': 0
    };
    
    // Count all connections for the selected node
    graph.links.forEach(link => {
        if (link.source.id === node.id || link.target.id === node.id) {
            const connectedNode = link.source.id === node.id ? link.target : link.source;
            const nodeType = connectedNode.type;
            connectionCounts[nodeType]++;
        }
    });
    
    // Get mean distribution for comparison
    const meanCounts = calculateMeanDistribution();
    
    // Calculate total connections for this node
    const totalConnections = Object.values(connectionCounts).reduce((a, b) => a + b, 0);
    
    // Prepare data for the chart
    const data = Object.entries(connectionCounts).map(([type, count]) => ({
        type: type,
        count: count,
        mean: meanCounts[type]
    }));
    
    // Set up the chart dimensions
    const margin = {top: 20, right: 20, bottom: 60, left: 40};
    const width = 250 - margin.left - margin.right;
    const height = 180 - margin.top - margin.bottom;
    
    // Create SVG
    const svg = d3.select("#connection-chart")
        .append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);
    
    // Create scales
    const x = d3.scaleBand()
        .range([0, width])
        .domain(data.map(d => d.type))
        .padding(0.1);
        
    const y = d3.scaleLinear()
        .range([height, 0])
        .domain([0, d3.max(data, d => Math.max(d.count, d.mean)) * 1.1]);
    
    // Add total connections label at the bottom
    svg.append("text")
        .attr("class", "total-label")
        .attr("x", width/2)
        .attr("y", height + margin.bottom - 5)
        .attr("text-anchor", "middle")
        .style("fill", "white")
        .style("font-size", "12px")
        .text(`Total Connections: ${totalConnections}`);
    
    // Add bars for actual counts
    svg.selectAll(".bar")
        .data(data)
        .enter().append("rect")
        .attr("class", "bar")
        .attr("x", d => x(d.type))
        .attr("width", x.bandwidth())
        .attr("y", d => y(d.count))
        .attr("height", d => height - y(d.count))
        .attr("fill", d => nodeColors[d.type])
        .attr("opacity", 0.8);
    
    // Add mean line
    svg.append("path")
        .datum(data)
        .attr("fill", "none")
        .attr("stroke", "black")
        .attr("stroke-width", 2)
        .attr("d", d3.line()
            .x(d => x(d.type) + x.bandwidth()/2)
            .y(d => y(d.mean))
        );
    
    // Add value labels
    svg.selectAll(".value-label")
        .data(data)
        .enter().append("text")
        .attr("class", "value-label")
        .attr("x", d => x(d.type) + x.bandwidth()/2)
        .attr("y", d => y(d.count) - 5)
        .attr("text-anchor", "middle")
        .style("fill", "white")
        .text(d => d.count);
    
    // Add axes with more space for labels
    const xAxis = svg.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(x));
    
    // Rotate and adjust labels
    xAxis.selectAll("text")
        .attr("class", "type-label")
        .style("fill", "white")
        .attr("transform", "rotate(-45)")
        .style("text-anchor", "end")
        .attr("dy", "1em");
        
    svg.append("g")
        .call(d3.axisLeft(y))
        .selectAll("text")
        .style("fill", "white");
}

// 在窗口加载完成后初始化
window.addEventListener('load', init);

// 处理窗口大小变化
window.addEventListener('resize', () => {
    const container = document.getElementById('graph');
    if (container) {
        width = container.clientWidth;
        height = container.clientHeight;
        
        if (simulation) {
            simulation.force('center', d3.forceCenter(width / 2, height / 2));
            simulation.alpha(0.3).restart();
        }
    }
}); 
