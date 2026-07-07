import { useState, useEffect, useMemo } from 'react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer
} from 'recharts';
import { Users, Activity } from 'lucide-react';
import { format, subMinutes, parseISO } from 'date-fns';
import { RefreshCw } from 'lucide-react';
import './index.css';

declare const __BUILD_TIME__: string;

// 전체 임직원 수 설정 (추후 수정 가능)
const TOTAL_EMPLOYEES = 11149;

// Types
type DataPoint = {
  timestamp: string;
  count: number;
};

type ViewMode = 'minute' | 'hour' | 'day';



// 선형 회귀를 이용한 예상 도달 시간 계산기 (y = ax + b)
const estimateLinearReachTime = (history: DataPoint[], targetCount: number, hoursLimit: number): Date | number | null => {
  if (history.length < 2) return null;
  
  const nowMs = new Date().getTime();
  const limitMs = nowMs - (hoursLimit * 60 * 60 * 1000);
  
  // Filter history to only include data within the hoursLimit
  const filtered = history.filter(d => new Date(d.timestamp).getTime() >= limitMs);
  
  if (filtered.length < 2) return null; // Not enough data in the given timeframe

  const sorted = [...filtered].sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const startTime = new Date(sorted[0].timestamp).getTime();
  
  let sumX = 0;
  let sumY = 0;
  let sumX2 = 0;
  let sumXY = 0;
  let n = sorted.length;
  
  for (const point of sorted) {
    // x = hours from start of timeframe
    const x = (new Date(point.timestamp).getTime() - startTime) / (1000 * 60 * 60); 
    const y = point.count;
    
    sumX += x;
    sumY += y;
    sumX2 += x * x;
    sumXY += x * y;
  }
  
  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return null;
  
  const m = (n * sumXY - sumX * sumY) / denominator;
  const b = (sumY - m * sumX) / n;
  
  if (m <= 0) return null; // 감소하거나 멈춰있으면 달성 불가
  
  const targetX = (targetCount - b) / m;
  if (targetX > 24 * 365) return Infinity; // 너무 먼 미래 (1년 이상)
  
  const targetTimeMs = startTime + (targetX * 1000 * 60 * 60);
  
  return new Date(targetTimeMs);
};

function App() {
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [history, setHistory] = useState<DataPoint[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('minute');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = async (isInitial = false) => {
    try {
      if (!isInitial) {
        setIsRefreshing(true);
      }
      
      const response = await fetch(`/api/history?t=${new Date().getTime()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch data');
      }
      
      const data = await response.json();
      
      if (data && data.length > 0) {
        setHistory(data);
        
        // Use the last item as current
        const lastItem = data[data.length - 1];
        setMemberCount(lastItem.count);
        setLastUpdated(new Date(lastItem.timestamp));
        
        localStorage.setItem('sds_union_data', JSON.stringify({
          totalMembers: lastItem.count,
          lastUpdated: lastItem.timestamp,
          history: data
        }));
      }
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Load history from localStorage or initialize
  useEffect(() => {
    const storedHistory = localStorage.getItem('sdsUnionHistory');
    
    if (storedHistory) {
      try {
        setHistory(JSON.parse(storedHistory));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
    
    fetchData(true);
    
    // Poll every 1 minute
    const intervalId = setInterval(() => fetchData(), 60000);
    return () => clearInterval(intervalId);
  }, []);

  // Process data based on view mode
  const chartData = useMemo(() => {
    if (history.length === 0) return [];
    
    const now = new Date();
    let filtered: DataPoint[] = [];

    if (viewMode === 'minute') {
      // Last 60 minutes
      const cutoff = subMinutes(now, 60);
      filtered = history.filter(d => parseISO(d.timestamp) >= cutoff);
    } else {
      // All days/hours (since beginning)
      filtered = history;
    }

    const buckets = new Map<number, DataPoint>();
    
    filtered.forEach(d => {
      const date = parseISO(d.timestamp);
      const timeMs = date.getTime();
      let bucketKey = timeMs;
      
      if (viewMode === 'minute') {
        bucketKey = Math.floor(timeMs / 60000) * 60000;
      } else if (viewMode === 'hour') {
        bucketKey = Math.floor(timeMs / 3600000) * 3600000;
      } else {
        // 자정(00:00:00) 데이터를 이전 날짜의 마지막 기록으로 취급하기 위해 1초 빼서 버킷 계산
        const localDate = new Date(timeMs - 1000);
        bucketKey = new Date(localDate.getFullYear(), localDate.getMonth(), localDate.getDate()).getTime();
      }
      
      // 순차적으로 덮어쓰므로 자연스럽게 해당 구간의 마지막(최종) 스냅샷이 저장됨
      buckets.set(bucketKey, d);
    });

    return Array.from(buckets.values())
      .map(d => ({
        time: parseISO(d.timestamp).getTime(),
        count: d.count
      }))
      .sort((a,b) => a.time - b.time);
  }, [history, viewMode]);

  // Number Counter Animation Component
  const AnimatedCounter = ({ value }: { value: number }) => {
    const [displayValue, setDisplayValue] = useState(0);

    useEffect(() => {
      if (value === 0) return;
      let startValue = displayValue;
      const duration = 1500;
      const startTime = performance.now();
      
      const updateCounter = (currentTime: number) => {
        const elapsedTime = currentTime - startTime;
        const progress = Math.min(elapsedTime / duration, 1);
        
        // Easing function (easeOutExpo)
        const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
        
        const currentVal = Math.floor(startValue + (value - startValue) * easeProgress);
        setDisplayValue(currentVal);
        
        if (progress < 1) {
          requestAnimationFrame(updateCounter);
        }
      };
      
      requestAnimationFrame(updateCounter);
    }, [value]);

    return <span>{displayValue.toLocaleString()}</span>;
  };

  const getFormattedEstimate = (targetCount: number, hoursLimit: number) => {
    if (memberCount !== null && memberCount >= targetCount) return '🎉 이미 달성!';
    if (history.length < 2) return '계산 중...';
    
    const estimate = estimateLinearReachTime(history, targetCount, hoursLimit);
    if (estimate === null) return '계산 불가';
    if (estimate === Infinity || (estimate instanceof Date && estimate.getTime() > new Date().getTime() + 1000 * 60 * 60 * 24 * 365 * 10)) {
      return '아득히 먼 미래 😢';
    }
    
    return format(estimate as Date, 'yyyy.MM.dd HH:mm');
  };

  const currentRate = memberCount ? ((memberCount / TOTAL_EMPLOYEES) * 100).toFixed(1) : "0.0";
  const target50Count = Math.floor(TOTAL_EMPLOYEES * 0.5);
  const target90Count = Math.floor(TOTAL_EMPLOYEES * 0.9);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      let formattedLabel = '';
      if (viewMode === 'minute') formattedLabel = format(new Date(label), 'HH:mm');
      else if (viewMode === 'hour') formattedLabel = format(new Date(label), 'MM.dd HH:00');
      else formattedLabel = format(new Date(label), 'MM.dd');

      return (
        <div className="glass-panel" style={{ padding: '1rem', margin: 0, minWidth: '150px' }}>
          <p style={{ color: 'var(--text-muted)', marginBottom: '0.5rem', fontSize: '0.9rem' }}>{formattedLabel}</p>
          <p style={{ color: 'var(--primary-color)', fontWeight: 800, fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Users size={18} />
            {payload[0].value.toLocaleString()}명
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="app-container">
      <div className="header fade-in delay-1">
        <h1 className="title">삼성SDS노동조합 가입 현황</h1>
        <p className="subtitle">이제부터 시작되는 우리의 새로운 발걸음 🚀</p>
      </div>

      <div className="glass-panel fade-in delay-2">
        <div className="counter-section">
          <h2 className="counter-label">실시간 가입자 수</h2>
          <div className="counter-value">
            <Users size={48} color="var(--primary-color)" />
            {memberCount !== null ? (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                <AnimatedCounter value={memberCount} />
                <span className="total-employee-count">/ {TOTAL_EMPLOYEES.toLocaleString()} (추정)</span>
              </div>
            ) : "..."}
          </div>
          <div className="status-indicator">
            <div className="status-dot"></div>
            <span>
              실시간 연동 중 {lastUpdated && `(마지막 업데이트: ${format(lastUpdated, 'HH:mm:ss')})`}
            </span>
            <button 
              onClick={() => fetchData()} 
              className="refresh-btn"
              disabled={isRefreshing}
              title="새로고침"
            >
              <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="stats-cards">
          <div className="stat-card">
            <h3>전체 가입율</h3>
            <div className="stat-value">{currentRate}%</div>
            <div className="stat-sub">({memberCount?.toLocaleString()} / {TOTAL_EMPLOYEES.toLocaleString()}명)</div>
          </div>
          <div className="stat-card">
            <h3>50% 달성 ({target50Count.toLocaleString()}명)</h3>
            <div className="stat-value">{getFormattedEstimate(target50Count, 6)}</div>
            <div className="stat-sub">예상 시기 (최근 6시간 기준)</div>
          </div>
          <div className="stat-card">
            <h3>90% 달성 ({target90Count.toLocaleString()}명)</h3>
            <div className="stat-value">{getFormattedEstimate(target90Count, 24)}</div>
            <div className="stat-sub">예상 시기 (최근 24시간 기준)</div>
          </div>
        </div>
      </div>

      <div className="glass-panel fade-in delay-3" style={{ flexGrow: 1 }}>
        <div className="controls">
          <button 
            className={`tab-btn ${viewMode === 'minute' ? 'active' : ''}`}
            onClick={() => setViewMode('minute')}
          >
            최근 60분
          </button>
          <button 
            className={`tab-btn ${viewMode === 'hour' ? 'active' : ''}`}
            onClick={() => setViewMode('hour')}
          >
            시간별
          </button>
          <button 
            className={`tab-btn ${viewMode === 'day' ? 'active' : ''}`}
            onClick={() => setViewMode('day')}
          >
            일별
          </button>
        </div>
        
        <div className="chart-container">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--primary-color)" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="var(--primary-color)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
                <XAxis 
                  dataKey="time" 
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  ticks={viewMode === 'day' ? chartData.map(d => d.time) : undefined}
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: 'var(--text-muted)', fontSize: 12 }} 
                  dy={10}
                  tickFormatter={(val) => {
                    if (viewMode === 'minute') return format(new Date(val), 'HH:mm');
                    if (viewMode === 'hour') return format(new Date(val), 'MM.dd HH:00');
                    return format(new Date(val), 'MM.dd');
                  }}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                  domain={viewMode === 'hour' ? [0, 'auto'] : ['dataMin - 100', 'dataMax + 100']}
                  tickFormatter={(val) => val.toLocaleString()}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area 
                  type="monotone" 
                  dataKey="count" 
                  stroke="var(--primary-color)" 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#colorCount)" 
                  animationDuration={1500}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)' }}>
              <Activity className="animate-spin" style={{ marginRight: '10px' }}/> 데이터를 불러오는 중...
            </div>
          )}
        </div>
      </div>

      <div className="footer fade-in delay-3">
        <div className="footer-content">
          <span>Made by 밐희</span>
          <span>Last Developed: {format(new Date(__BUILD_TIME__), 'MM/dd HH:mm')}</span>
        </div>
      </div>
    </div>
  );
}

export default App;
