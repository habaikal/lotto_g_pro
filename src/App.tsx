import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { RefreshCw, BarChart2, ShieldCheck, Zap, TrendingUp, Settings, Download, Share, Trash2 } from 'lucide-react';
import * as XLSX from 'xlsx';

/**
 * LOTTO GENIUS - 통계적 균형 및 비인기 조합 필터 기반 로또 번호 생성기
 */

// --- Constants & Utilities ---

const getBallStyle = (num: number) => {
    if (num <= 10) return {
        bg: 'from-amber-300 via-yellow-500 to-amber-600',
        shadow: 'shadow-amber-500/50',
        text: 'text-yellow-900 border-amber-400/50'
    };
    if (num <= 20) return {
        bg: 'from-blue-300 via-blue-500 to-blue-700',
        shadow: 'shadow-blue-500/50',
        text: 'text-white border-blue-400/50'
    };
    if (num <= 30) return {
        bg: 'from-red-300 via-red-500 to-red-700',
        shadow: 'shadow-red-500/50',
        text: 'text-white border-red-400/50'
    };
    if (num <= 40) return {
        bg: 'from-slate-300 via-slate-500 to-slate-700',
        shadow: 'shadow-slate-500/50',
        text: 'text-white border-slate-400/50'
    };
    return {
        bg: 'from-emerald-300 via-emerald-500 to-emerald-700',
        shadow: 'shadow-emerald-500/50',
        text: 'text-white border-emerald-400/50'
    };
};

// Types
type LottoDraw = number[];
type Stats = {
    avgSum: number;
    hotNumbers: { num: number, count: number }[]; // Store count for weighting
    coldNumbers: number[]; // Track numbers that haven't appeared recently
    lastDraw: number[]; // Store recent draw for checking against previous drawing
};
type Game = {
    numbers: number[];
    sum: number;
    oddCount: number;
    hotCount: number;
};

// --- Components ---

const LottoBall = ({ number, animate }: { number: number, animate?: boolean }) => {
    const style = getBallStyle(number);

    return (
        <div className={`relative group ${animate ? 'animate-bounce-short' : ''} transition-transform duration-300 hover:scale-110 z-10`}>
            {/* Main Ball Body */}
            <div
                className={`
                    w-10 h-10 sm:w-12 sm:h-12 rounded-full 
                    flex items-center justify-center 
                    font-bold text-lg sm:text-xl font-mono
                    bg-gradient-to-br ${style.bg}
                    box-shadow-2xl shadow-lg ${style.shadow}
                    relative overflow-hidden
                    border border-white/20
                    ${style.text}
                `}
                style={{
                    boxShadow: 'inset -5px -5px 10px rgba(0,0,0,0.3), inset 2px 2px 5px rgba(255,255,255,0.3)',
                }}
            >
                {/* Specular Highlight (The "Shine") */}
                <div className="absolute top-1 left-2 w-4 h-2 bg-white/40 blur-sm rounded-full transform -rotate-45"></div>

                {/* Text Shadow for better contrast */}
                <span className="drop-shadow-md z-10 filter">{number}</span>
            </div>

            {/* Ground Reflection/Shadow */}
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-8 h-1 bg-black/30 blur-md rounded-full -z-10 group-hover:scale-90 transition-transform duration-300"></div>
        </div>
    );
};

const StatCard = ({ title, value, subtext, icon: Icon, colorClass }: any) => (
    <div className="bg-white/5 backdrop-blur-md border border-white/10 p-4 rounded-xl flex items-center space-x-4">
        <div className={`p-3 rounded-lg ${colorClass} bg-opacity-20`}>
            <Icon className={`w-6 h-6 ${colorClass.replace('bg-', 'text-')}`} />
        </div>
        <div>
            <h3 className="text-slate-400 text-xs uppercase tracking-wider">{title}</h3>
            <div className="text-2xl font-bold text-white">{value}</div>
            {subtext && <div className="text-xs text-slate-500">{subtext}</div>}
        </div>
    </div>
);

export default function LottoGenius() {
    // State
    const [historyData, setHistoryData] = useState<LottoDraw[]>([]);


    const [tolerance, setTolerance] = useState(0.05); // 5% default
    const [generatedGames, setGeneratedGames] = useState<Game[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [stats, setStats] = useState<Stats>({ avgSum: 0, hotNumbers: [], coldNumbers: [], lastDraw: [] });
    const [logs, setLogs] = useState<string[]>([]);
    const [targetGameCount, setTargetGameCount] = useState<number>(50);


    // Auto-load data from Supabase on mount
    useEffect(() => {
        const fetchLottoData = async () => {
            try {
                let allData: any[] = [];
                let page = 0;
                const pageSize = 1000;
                let hasMore = true;

                while (hasMore) {
                    const { data, error } = await supabase
                        .from('lotto_draws')
                        .select('*')
                        .order('draw_no', { ascending: true })
                        .range(page * pageSize, (page + 1) * pageSize - 1);

                    if (error) throw error;

                    if (data && data.length > 0) {
                        allData = [...allData, ...data];
                        if (data.length < pageSize) {
                            hasMore = false;
                        } else {
                            page++;
                        }
                    } else {
                        hasMore = false;
                    }
                }

                if (allData.length > 0) {
                    // Map Supabase data to the format expected by the app (array of numbers)
                    // Schema: draw_no, date, num1, num2, num3, num4, num5, num6, bonus
                    const formattedData: LottoDraw[] = allData.map(record => [
                        record.num1,
                        record.num2,
                        record.num3,
                        record.num4,
                        record.num5,
                        record.num6
                    ]);

                    setHistoryData(formattedData);

                    // Find the max draw number
                    const maxDraw = allData.reduce((max, record) => Math.max(max, record.draw_no), 0);

                    console.log(`Loaded ${allData.length} records in total. Last Round: ${maxDraw}`);
                }
            } catch (err) {
                console.error("Failed to load data from Supabase:", err);
            }
        };

        fetchLottoData();
    }, []);

    // --- Statistics Calculation ---
    useEffect(() => {
        if (!historyData || historyData.length === 0) return;

        // 1. Calculate Average Sum
        let totalSum = 0;
        const frequency: Record<number, number> = {};

        // Track recency for cold numbers
        const lastAppearance: Record<number, number> = {};

        historyData.forEach((draw, index) => {
            const sum = draw.reduce((a, b) => a + b, 0);
            totalSum += sum;
            draw.forEach(num => {
                frequency[num] = (frequency[num] || 0) + 1;
                lastAppearance[num] = index; // The higher the index, the more recent
            });
        });

        const avgSum = totalSum / historyData.length;

        // 2. Identify Hot and Cold Numbers
        const sortedNums = Object.keys(frequency)
            .map(num => ({ num: parseInt(num), count: frequency[parseInt(num)] }))
            .sort((a, b) => b.count - a.count);

        // 15주(15회차) 이상 미출현 번호 찾기
        const recentHistoryLimit = historyData.length - 15;
        const coldNumbers = [];
        for (let i = 1; i <= 45; i++) {
            if ((lastAppearance[i] ?? -1) < recentHistoryLimit) {
                coldNumbers.push(i);
            }
        }

        // Store recent draw
        const lastDraw = historyData[historyData.length - 1] || [];

        setStats({ avgSum, hotNumbers: sortedNums.slice(0, 10), coldNumbers, lastDraw });
    }, [historyData]);





    // --- Core Algorithm ---
    const generateLottoNumbers = async () => {
        setIsGenerating(true);
        setGeneratedGames([]);
        setLogs([]);

        await new Promise(r => setTimeout(r, 100)); // UI block방지

        const newGames: Game[] = [];
        let attempts = 0;
        const maxAttempts = 50000;

        // Default stats if no data loaded
        const currentAvgSum = stats.avgSum || 138;

        const targetMin = currentAvgSum * (1 - tolerance);
        const targetMax = currentAvgSum * (1 + tolerance);

        const addLog = (msg: string) => {
            setLogs(prev => [`[Pro 필터] ${msg}`, ...prev].slice(0, 8));
        };

        const currentHotNumbers = stats.hotNumbers.length > 0 ? stats.hotNumbers.map(n => n.num) : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

        // 룰렛 가중치 계산 O(1) 준비
        // 기본 가중치 10으로 시작. Hot=5(확률감소), Cold=30(확률증가 3배) 등.
        const weights: Record<number, number> = {};
        for (let i = 1; i <= 45; i++) {
            let weight = 10;
            if (stats.coldNumbers.includes(i)) weight = 30; // 콜드 번호 가중치 UP
            else if (currentHotNumbers.includes(i)) weight = 5; // 핫 번호 가중치 DOWN
            weights[i] = weight;
        }

        while (newGames.length < targetGameCount && attempts < maxAttempts) {
            attempts++;

            // 1. Roulette Wheel Selection (가중치 기반 추첨)
            const numbers = new Set<number>();
            while (numbers.size < 6) {
                // 남은 번호들 중에서 룰렛 가중치 계산
                let totalWeight = 0;
                for (let i = 1; i <= 45; i++) {
                    if (!numbers.has(i)) totalWeight += weights[i];
                }

                let randomVal = Math.random() * totalWeight;
                for (let i = 1; i <= 45; i++) {
                    if (!numbers.has(i)) {
                        randomVal -= weights[i];
                        if (randomVal <= 0) {
                            numbers.add(i);
                            break;
                        }
                    }
                }
            }
            const candidate = Array.from(numbers).sort((a, b) => a - b);

            // --- FILTER 1: Statistical Balance (Sum) ---
            const sum = candidate.reduce((a, b) => a + b, 0);
            if (sum < targetMin || sum > targetMax) {
                continue;
            }

            // --- FILTER 2: 강화된 Pro 로직 필터 ---

            // 2-1. 연속 번호 (4연속 이상 제한 - 확장됨)
            let consecutiveCount = 0;
            let hasFourConsecutive = false;
            for (let i = 0; i < candidate.length - 1; i++) {
                if (candidate[i] + 1 === candidate[i + 1]) {
                    consecutiveCount++;
                    if (consecutiveCount >= 3) hasFourConsecutive = true; // 3 implies 4 consecutive numbers (e.g. 1-2, 2-3, 3-4 = 3 ties)
                } else {
                    consecutiveCount = 0;
                }
            }
            if (hasFourConsecutive) {
                if (attempts % 100 === 0) addLog(`4연속 번호 발견 배제`);
                continue;
            }

            // 2-2. 과열 번호 과다 (4개 이상 제한 - 확장됨)
            const hotCount = candidate.filter(n => currentHotNumbers.includes(n)).length;
            if (hotCount >= 4) {
                if (attempts % 100 === 0) addLog(`인기 번호 4개이상 중복 배제`);
                continue;
            }

            // 2-3. 생일 패턴/낮은 번호 (모두 31 이하)
            const allBirthday = candidate.every(n => n <= 31);
            if (allBirthday) {
                continue;
            }

            // 2-4. 홀짝 쏠림 (0:6, 6:0, 1:5, 5:1 제한)
            const oddCount = candidate.filter(n => n % 2 !== 0).length;
            if (oddCount === 0 || oddCount === 6 || oddCount === 1 || oddCount === 5) {
                continue;
            }

            // 2-5. 끝수 집중도 (동일 끝수 4개 이상 제한 - 신규)
            const endDigits = candidate.map(n => n % 10);
            const digitCounts: Record<number, number> = {};
            let hasFourSameEndDigit = false;
            for (const digit of endDigits) {
                digitCounts[digit] = (digitCounts[digit] || 0) + 1;
                if (digitCounts[digit] >= 4) {
                    hasFourSameEndDigit = true;
                    break;
                }
            }
            if (hasFourSameEndDigit) {
                if (attempts % 100 === 0) addLog(`동일 끝수 4개 이상 배제`);
                continue;
            }

            // 2-6. 직전 회차 중복 (직전 당첨 번호 4개 이상 일치 제한 - 신규)
            if (stats.lastDraw && stats.lastDraw.length > 0) {
                const prevMatchCount = candidate.filter(n => stats.lastDraw.includes(n)).length;
                if (prevMatchCount >= 4) {
                    if (attempts % 100 === 0) addLog(`직전 회차 4개 이상 중복 배제`);
                    continue;
                }
            }

            // 2-7. 역대 1등 조합 회피 (과거 당첨 번호와 5개 이상 일치 제한 - 신규)
            let isPastWinner = false;
            // 성능을 위해 배열을 문자열이나 Set보다는 단순 교집합으로 빠르게 체크
            for (let i = 0; i < historyData.length; i++) {
                const hDraw = historyData[i];
                let matchCount = 0;
                for (let j = 0; j < 6; j++) {
                    if (candidate.includes(hDraw[j])) matchCount++;
                }

                if (matchCount >= 5) {
                    isPastWinner = true;
                    break;
                }
            }

            if (isPastWinner) {
                if (attempts % 10 === 0) addLog(`역대 1등(5개 이상) 조합 회피 필터 발동!`);
                continue;
            }

            // Success
            newGames.push({ numbers: candidate, sum, oddCount, hotCount });
        }

        if (attempts >= maxAttempts) {
            addLog(`최대 시도 횟수(${maxAttempts}) 도달하여 생성 종료.`);
        }

        setGeneratedGames(newGames);
        setIsGenerating(false);
    };

    const handleDownload = () => {
        if (generatedGames.length === 0) return;

        const data = generatedGames.map((game, i) => ({
            '선택': `게임 ${i + 1}`,
            '번호 1': game.numbers[0],
            '번호 2': game.numbers[1],
            '번호 3': game.numbers[2],
            '번호 4': game.numbers[3],
            '번호 5': game.numbers[4],
            '번호 6': game.numbers[5],
            '합계': game.sum,
            '홀짝 비율': `${game.oddCount}:${6 - game.oddCount}`,
        }));

        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Lotto Numbers");

        XLSX.writeFile(workbook, `lotto_genius_${new Date().toISOString().slice(0, 10)}.xlsx`);
    };

    const handleSend = async () => {
        if (generatedGames.length === 0) return;

        const data = generatedGames.map((game, i) => ({
            '선택': `게임 ${i + 1}`,
            '번호 1': game.numbers[0],
            '번호 2': game.numbers[1],
            '번호 3': game.numbers[2],
            '번호 4': game.numbers[3],
            '번호 5': game.numbers[4],
            '번호 6': game.numbers[5],
            '합계': game.sum,
            '홀짝 비율': `${game.oddCount}:${6 - game.oddCount}`,
        }));

        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Lotto Numbers");

        const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const file = new File([blob], `lotto_genius_${new Date().toISOString().slice(0, 10)}.xlsx`, { type: blob.type });

        const contentStr = generatedGames.map((game, i) =>
            `[Lotto Genius Pro] 게임 ${i + 1}: ${game.numbers.join(', ')}`
        ).join('\n');

        let sharedFile = false;
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({
                    files: [file],
                    title: 'Lotto Genius Pro Picks',
                    text: 'Lotto Genius Pro에서 생성된 로또 번호 엑셀 파일입니다.',
                });
                sharedFile = true;
            } catch (err) {
                if (err instanceof Error && err.name === 'AbortError') return;
                console.log('File share failed, falling back to text', err);
            }
        }

        if (!sharedFile) {
            if (navigator.share) {
                try {
                    await navigator.share({
                        title: 'Lotto Genius Pro Picks',
                        text: contentStr,
                    });
                } catch (err) {
                    if (err instanceof Error && err.name === 'AbortError') return;
                    console.log('Text share failed, falling back to clipboard', err);
                    try {
                        await navigator.clipboard.writeText(contentStr);
                        alert("웹 브라우저 환경 설정으로 인해 텍스트로 클립보드에 복사되었습니다.");
                    } catch (e) {
                        alert("복사 실패");
                    }
                }
            } else {
                try {
                    await navigator.clipboard.writeText(contentStr);
                    alert("기기에서 파일 공유 기능을 지원하지 않아 텍스트로 클립보드에 복사되었습니다. (파일을 얻으려면 다운로드 버튼을 이용하세요)");
                } catch (err) {
                    alert("복사 실패");
                }
            }
        }
    };

    return (
        <div className="min-h-screen bg-slate-900 text-slate-200 font-sans selection:bg-emerald-500 selection:text-white pb-20">
            {/* Header */}
            <header className="bg-slate-800/50 backdrop-blur-lg border-b border-white/5 sticky top-0 z-50">
                <div className="max-w-4xl mx-auto px-6 py-4 flex justify-between items-center">
                    <div className="flex items-center space-x-2">
                        <div className="bg-gradient-to-tr from-emerald-400 to-cyan-500 p-2 rounded-lg shadow-lg shadow-emerald-500/20">
                            <Zap className="w-6 h-6 text-white" fill="currentColor" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-white tracking-tight">Lotto Genius <span className="text-purple-400">PRO</span> <span className="text-xs text-slate-500 font-normal ml-1">v2.0</span></h1>
                            <p className="text-xs text-slate-400">지능형 룰렛 가중치 기반 로또 예측 시스템</p>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">

                {/* Intro/Upload Section */}
                <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-xl relative overflow-hidden group">
                        <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-purple-500 blur-3xl opacity-20 group-hover:opacity-30 transition"></div>

                        <h2 className="text-lg font-semibold text-white mb-4 flex items-center">
                            <Settings className="w-5 h-5 mr-2 text-purple-400" />
                            분석 설정
                        </h2>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm text-slate-400 mb-2">데이터베이스 상태</label>
                                <div className="px-3 py-3 bg-slate-900 border border-slate-700 rounded-lg flex justify-between items-center">
                                    <div className="flex items-center space-x-2 text-emerald-400">
                                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                                        <span className="text-sm font-semibold">최종회차</span>
                                    </div>
                                    <div className="text-lg text-white font-bold font-mono bg-slate-800 px-3 py-1 rounded border border-slate-700">
                                        {historyData.length > 0 ? historyData.length : '...'}회
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm text-slate-400 mb-2">예측 허용 범위 (Tolerance)</label>
                                <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-700">
                                    <button
                                        onClick={() => setTolerance(0.02)}
                                        className={`flex-1 py-1.5 text-sm rounded-md transition ${tolerance === 0.02 ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                                    >
                                        Strict (±2%)
                                    </button>
                                    <button
                                        onClick={() => setTolerance(0.05)}
                                        className={`flex-1 py-1.5 text-sm rounded-md transition ${tolerance === 0.05 ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                                    >
                                        Standard (±5%)
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm text-slate-400 mb-2">생성 게임 수 (0-50)</label>
                                <div className="flex items-center space-x-3">
                                    <input
                                        type="range"
                                        min="0"
                                        max="50"
                                        value={targetGameCount}
                                        onChange={(e) => setTargetGameCount(parseInt(e.target.value))}
                                        className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                                    />
                                    <span className="bg-slate-900 px-3 py-1 rounded text-white font-mono min-w-[3rem] text-center border border-slate-700">{targetGameCount}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Stats Dashboard */}
                    <div className="grid grid-cols-1 gap-4">
                        <StatCard
                            title="평균 합계 (Avg Sum)"
                            value={stats.avgSum > 0 ? stats.avgSum.toFixed(1) : "N/A"}
                            subtext={stats.avgSum > 0 ? `Target: ${(stats.avgSum * (1 - tolerance)).toFixed(0)} ~ ${(stats.avgSum * (1 + tolerance)).toFixed(0)}` : "데이터 로드 필요"}
                            icon={TrendingUp}
                            colorClass="bg-emerald-500"
                        />
                        <StatCard
                            title="최다 빈출 (Hot Numbers)"
                            value={stats.hotNumbers.length > 0 ? stats.hotNumbers.slice(0, 5).map(n => n.num).join(', ') : "N/A"}
                            subtext="Too hot to handle? (가중치 최소화 적용)"
                            icon={BarChart2}
                            colorClass="bg-orange-500"
                        />
                    </div>
                </section>

                {/* Action Button */}
                <div className="flex justify-center space-x-4">
                    <button
                        onClick={generateLottoNumbers}
                        disabled={isGenerating || historyData.length === 0}
                        className={`
              relative overflow-hidden group
              px-12 py-5 rounded-full font-bold text-xl tracking-wider
              text-white shadow-[0_0_40px_-10px_rgba(16,185,129,0.5)]
              transition-all duration-300 transform hover:scale-105 active:scale-95
              ${(isGenerating || historyData.length === 0) ? 'bg-slate-700 cursor-not-allowed opacity-50' : 'bg-gradient-to-r from-purple-600 to-indigo-500 hover:from-purple-500 hover:to-indigo-400'}
            `}
                    >
                        <span className="relative z-10 flex items-center space-x-3">
                            {isGenerating ? (
                                <>
                                    <RefreshCw className="w-6 h-6 animate-spin" />
                                    <span>분석 중...</span>
                                </>
                            ) : (
                                <>
                                    <Zap className="w-6 h-6" fill="currentColor" />
                                    <span>AI 번호 생성</span>
                                </>
                            )}
                        </span>
                    </button>

                    <button
                        onClick={() => {
                            setGeneratedGames([]);
                            setLogs([]);
                        }}
                        disabled={generatedGames.length === 0}
                        className={`
                            px-6 py-5 rounded-full font-bold text-lg
                            transition-all duration-300 transform hover:scale-105 active:scale-95
                            border border-slate-600 text-slate-400 hover:text-white hover:border-slate-500 hover:bg-slate-800
                            flex items-center space-x-2
                            ${generatedGames.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}
                        `}
                    >
                        <Trash2 className="w-5 h-5" />
                        <span>초기화</span>
                    </button>
                </div>

                {/* Logs Area */}
                {logs.length > 0 && (
                    <div className="bg-black/30 rounded-lg p-3 text-xs font-mono text-slate-500 overflow-hidden border border-slate-800">
                        {logs.map((log, i) => (
                            <div key={i} className="truncate">{log}</div>
                        ))}
                    </div>
                )}

                {/* Results Section */}
                {generatedGames.length > 0 && (
                    <section className="space-y-4 animate-fade-in-up">
                        <div className="flex flex-col sm:flex-row justify-between items-center bg-slate-800/80 p-4 rounded-xl border-l-4 border-emerald-500 backdrop-blur">
                            <h3 className="text-xl font-bold text-white flex items-center space-x-2 mb-4 sm:mb-0">
                                <span>추천 조합</span>
                                <span className="text-sm font-normal text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
                                    {generatedGames.length} Games
                                </span>
                            </h3>

                            <div className="flex space-x-2">
                                <button
                                    onClick={handleDownload}
                                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg transition border border-slate-600"
                                >
                                    <Download className="w-4 h-4" />
                                    <span>저장</span>
                                </button>
                                <button
                                    onClick={handleSend}
                                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition shadow-lg shadow-indigo-500/20"
                                >
                                    <Share className="w-4 h-4" />
                                    <span>전송</span>
                                </button>
                            </div>
                        </div>

                        <div className="grid gap-4">
                            {generatedGames.map((game, index) => (
                                <div
                                    key={index}
                                    className="bg-slate-800/80 backdrop-blur border border-slate-700 rounded-xl p-4 sm:p-6 flex flex-col sm:flex-row items-center justify-between hover:border-emerald-500/50 transition duration-300 group shadow-lg"
                                >
                                    <div className="flex items-center space-x-4 mb-4 sm:mb-0 w-full sm:w-auto justify-center">
                                        <span className="text-slate-500 font-mono text-sm mr-2">#{index + 1}</span>
                                        <div className="flex space-x-2 sm:space-x-3">
                                            {game.numbers.map((num) => (
                                                <LottoBall key={num} number={num} animate={true} />
                                            ))}
                                        </div>
                                    </div>

                                    <div className="flex space-x-6 text-xs sm:text-sm text-slate-400 w-full sm:w-auto justify-between sm:justify-end px-4 sm:px-0 border-t sm:border-t-0 border-slate-700 pt-3 sm:pt-0 mt-2 sm:mt-0">
                                        <div className="flex flex-col items-center sm:items-end">
                                            <span className="text-xs text-slate-600 uppercase">Sum</span>
                                            <span className="text-emerald-400 font-bold">{game.sum}</span>
                                        </div>
                                        <div className="flex flex-col items-center sm:items-end">
                                            <span className="text-xs text-slate-600 uppercase">Odd/Even</span>
                                            <span className="text-slate-300">{game.oddCount}:{6 - game.oddCount}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Algorithm Info */}
                <section className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mt-8">
                    <h4 className="text-slate-300 font-semibold mb-4 flex items-center">
                        <ShieldCheck className="w-5 h-5 mr-2 text-purple-400" />
                        Lotto Genius Pro 알고리즘
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-slate-400">
                        <div className="flex items-start space-x-2">
                            <div className="w-1.5 h-1.5 mt-1.5 rounded-full bg-purple-500 shrink-0"></div>
                            <p><strong>가중치 룰렛:</strong> 장기 미출현 번호(가중치UP), 최다 빈출(가중치DOWN) 기반 지능형 추출</p>
                        </div>
                        <div className="flex items-start space-x-2">
                            <div className="w-1.5 h-1.5 mt-1.5 rounded-full bg-purple-500 shrink-0"></div>
                            <p><strong>디펜시브 필터:</strong> 과거 1등 번호 5개 이상 일치 배제, 직전 당첨 번호 4개이상 중복 배제</p>
                        </div>
                        <div className="flex items-start space-x-2">
                            <div className="w-1.5 h-1.5 mt-1.5 rounded-full bg-purple-500 shrink-0"></div>
                            <p><strong>패턴 필터:</strong> 4연속 번호 제외, 끝자리 4개 이상 중복 제외, 인기번호 4개 이상 중복 제외</p>
                        </div>
                        <div className="flex items-start space-x-2">
                            <div className="w-1.5 h-1.5 mt-1.5 rounded-full bg-purple-500 shrink-0"></div>
                            <p><strong>기본 밸런스:</strong> 전체 합계 분석(±{tolerance * 100}%), 극단적 홀짝(6:0) 및 생일번호(1~31) 제한</p>
                        </div>
                    </div>
                </section>
            </main>
        </div>
    );
}
