import { useState, useEffect, useMemo } from 'react';
import type { FormEvent } from 'react';
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
const TOTAL_EMPLOYEES = 11287;

// Types
type DataPoint = {
  timestamp: string;
  count: number;
};

type ViewMode = 'minute' | 'hour' | 'day';

type Comment = {
  id: number;
  author: string;
  content: string;
  created_at: string;
};

// KST(한국 표준시)로 작성 시간 포맷팅
const formatKST = (isoString: string): string => {
  try {
    const date = new Date(isoString);
    const parts = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}.${get('month')}.${get('day')} ${get('hour')}:${get('minute')} (KST)`;
  } catch {
    return isoString;
  }
};



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

// 로그 근사를 이용한 예상 도달 시간 계산기 (y = a * ln(t+1) + b)
const estimateLogarithmicReachTime = (history: DataPoint[], targetCount: number, hoursLimit: number): Date | number | null => {
  if (history.length < 2) return null;
  
  const nowMs = new Date().getTime();
  const limitMs = nowMs - (hoursLimit * 60 * 60 * 1000);
  
  const filtered = history.filter(d => new Date(d.timestamp).getTime() >= limitMs);
  if (filtered.length < 2) return null;

  const sorted = [...filtered].sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const startTime = new Date(sorted[0].timestamp).getTime();
  
  let sumX = 0;
  let sumY = 0;
  let sumX2 = 0;
  let sumXY = 0;
  let n = sorted.length;
  
  for (const point of sorted) {
    const t = (new Date(point.timestamp).getTime() - startTime) / (1000 * 60 * 60);
    const x = Math.log(t + 1); // +1 to avoid log(0)
    const y = point.count;
    
    sumX += x;
    sumY += y;
    sumX2 += x * x;
    sumXY += x * y;
  }
  
  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return null;
  
  const a = (n * sumXY - sumX * sumY) / denominator;
  const b = (sumY - a * sumX) / n;
  
  if (a <= 0) return null; // 감소하거나 멈춰있으면 달성 불가
  
  const targetT = Math.exp((targetCount - b) / a) - 1;
  if (targetT > 24 * 365) return Infinity; // 너무 먼 미래
  
  const targetTimeMs = startTime + (targetT * 1000 * 60 * 60);
  
  return new Date(targetTimeMs);
};

function App() {
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [history, setHistory] = useState<DataPoint[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('minute');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  
  const [activeUsers, setActiveUsers] = useState<number>(0);
  const [totalViews, setTotalViews] = useState<number>(0);

  const [isRefreshing, setIsRefreshing] = useState(false);

  // 방명록(자유 코멘트)
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentAuthor, setCommentAuthor] = useState('');
  const [commentContent, setCommentContent] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  const fetchComments = async () => {
    try {
      const res = await fetch(`/api/comments?t=${new Date().getTime()}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setComments(data);
      }
    } catch (err) {
      console.error('Error fetching comments:', err);
    }
  };

  const handleSubmitComment = async (e: FormEvent) => {
    e.preventDefault();
    const author = commentAuthor.trim();
    const content = commentContent.trim();

    if (!author || !content) {
      setCommentError('작성자와 내용을 모두 입력해주세요.');
      return;
    }

    setIsSubmittingComment(true);
    setCommentError(null);

    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author, content }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '등록에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }

      const newComment: Comment = await res.json();
      setComments((prev) => [newComment, ...prev]);
      setCommentContent('');
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : '등록에 실패했습니다.');
    } finally {
      setIsSubmittingComment(false);
    }
  };

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
    fetchComments();

    // Poll every 1 minute for history
    const intervalId = setInterval(() => fetchData(), 60000);
    return () => clearInterval(intervalId);
  }, []);

  // Ping for active users
  useEffect(() => {
    let sessionId = sessionStorage.getItem('sds_union_session_id');
    let isNewVisit = false;
    
    if (!sessionId) {
      sessionId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
      sessionStorage.setItem('sds_union_session_id', sessionId);
      isNewVisit = true;
    }

    const ping = async (isNew: boolean) => {
      try {
        const res = await fetch(`/api/ping?sessionId=${sessionId}&isNewVisit=${isNew}`);
        if (res.ok) {
          const data = await res.json();
          setActiveUsers(data.activeUsers);
          setTotalViews(data.totalViews);
        }
      } catch (err) {
        console.error('Ping failed', err);
      }
    };

    ping(isNewVisit);
    
    // Poll every 15 seconds
    const pingIntervalId = setInterval(() => ping(false), 15000);
    return () => clearInterval(pingIntervalId);
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

    return Array.from(buckets.entries())
      .map(([bucketKey, d]) => ({
        time: viewMode === 'day' ? bucketKey : parseISO(d.timestamp).getTime(),
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

  const getFormattedEstimate = (targetCount: number, hoursLimit: number, useLog = false) => {
    if (memberCount !== null && memberCount >= targetCount) {
      const achievedPoint = history.find(d => d.count >= targetCount);
      const achievedTimeStr = achievedPoint ? format(parseISO(achievedPoint.timestamp), 'yy.MM.dd HH:mm') : '알 수 없음';
      return { achieved: true, text: `🎉 달성 완료!`, subText: `${achievedTimeStr}` };
    }
    
    const subTextStr = useLog ? `예상 시기 (최근 ${hoursLimit}시간 로그 추세)` : `예상 시기 (최근 ${hoursLimit}시간 기준)`;
    
    if (history.length < 2) return { achieved: false, text: '계산 중...', subText: subTextStr };
    
    const estimate = useLog ? estimateLogarithmicReachTime(history, targetCount, hoursLimit) : estimateLinearReachTime(history, targetCount, hoursLimit);
    
    if (estimate === null) return { achieved: false, text: '계산 불가', subText: subTextStr };
    if (estimate === Infinity || (estimate instanceof Date && estimate.getTime() > new Date().getTime() + 1000 * 60 * 60 * 24 * 365 * 10)) {
      return { achieved: false, text: '아득히 먼 미래 😢', subText: subTextStr };
    }
    
    return { achieved: false, text: format(estimate as Date, 'yyyy.MM.dd HH:mm'), subText: subTextStr };
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
          
          <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,107,107,0.1)', color: 'var(--primary-color)', padding: '6px 14px', borderRadius: '20px', fontSize: '0.9rem', fontWeight: 700, letterSpacing: '-0.5px' }}>
              <span className="status-dot" style={{ backgroundColor: 'var(--primary-color)', animation: 'pulse-primary 2s infinite' }}></span>
              현재 접속자 {activeUsers}명
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(132,94,194,0.1)', color: 'var(--secondary-color)', padding: '6px 14px', borderRadius: '20px', fontSize: '0.9rem', fontWeight: 700, letterSpacing: '-0.5px' }}>
              👁️ 누적 방문 {totalViews.toLocaleString()}명
              <span style={{ fontSize: '0.75rem', fontWeight: 500, opacity: 0.7, marginLeft: '2px' }}>(7/7 18:00 부터)</span>
            </div>
          </div>
        </div>

        <div className="stats-cards">
          <div className="stat-card">
            <h3>전체 가입율</h3>
            <div className="stat-value">{currentRate}%</div>
            <div className="stat-sub">({memberCount?.toLocaleString()} / {TOTAL_EMPLOYEES.toLocaleString()}명)</div>
          </div>
          
          {(() => {
            const est50 = getFormattedEstimate(target50Count, 6);
            return (
              <div className={`stat-card ${est50.achieved ? 'achieved' : ''}`}>
                <h3>50% 달성 ({est50.achieved ? '완료' : `${(target50Count - (memberCount || 0)).toLocaleString()}명 남음`})</h3>
                <div className="stat-value">{est50.text}</div>
                <div className="stat-sub">{est50.subText}</div>
              </div>
            );
          })()}
          
          {(() => {
            const est90 = getFormattedEstimate(target90Count, 24, true);
            return (
              <div className={`stat-card ${est90.achieved ? 'achieved' : ''}`}>
                <h3>90% 달성 ({est90.achieved ? '완료' : `${(target90Count - (memberCount || 0)).toLocaleString()}명 남음`})</h3>
                <div className="stat-value">{est90.text}</div>
                <div className="stat-sub">{est90.subText}</div>
              </div>
            );
          })()}
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

      <div className="glass-panel fade-in delay-3">
        <div className="comments-section">
          <h2 className="comments-title">💬 자유 게시판</h2>

          <div className="comments-notice">
            <strong>📌 게시판 이용 안내</strong>
            <p>
              본 게시판은 <strong>수정 및 삭제가 불가능</strong>합니다. 신중하게 작성해 주세요.
              또한 <strong>욕설·비방·정치·인종 차별적인 글</strong> 등 부적절한 게시물은
              관리자에 의해 <strong>예고 없이 삭제</strong>될 수 있습니다.
              서로를 존중하는 따뜻한 공간을 함께 만들어 주세요. 🙏
            </p>
          </div>

          <form className="comment-form" onSubmit={handleSubmitComment}>
            <input
              type="text"
              className="comment-author-input"
              placeholder="작성자"
              value={commentAuthor}
              onChange={(e) => setCommentAuthor(e.target.value)}
              maxLength={20}
              disabled={isSubmittingComment}
            />
            <textarea
              className="comment-content-input"
              placeholder="따뜻한 응원의 한마디를 남겨주세요 :)"
              value={commentContent}
              onChange={(e) => setCommentContent(e.target.value)}
              maxLength={500}
              rows={3}
              disabled={isSubmittingComment}
            />
            {commentError && <div className="comment-error">{commentError}</div>}
            <button type="submit" className="comment-submit-btn" disabled={isSubmittingComment}>
              {isSubmittingComment ? '게시 중...' : '게시하기'}
            </button>
          </form>

          <div className="comment-list">
            {comments.length === 0 ? (
              <div className="comment-empty">아직 등록된 글이 없어요. 첫 번째 글을 남겨보세요! ✍️</div>
            ) : (
              comments.map((c) => (
                <div className="comment-item" key={c.id}>
                  <div className="comment-item-header">
                    <span className="comment-item-author">{c.author}</span>
                    <span className="comment-item-time">{formatKST(c.created_at)}</span>
                  </div>
                  <p className="comment-item-content">{c.content}</p>
                </div>
              ))
            )}
          </div>
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
