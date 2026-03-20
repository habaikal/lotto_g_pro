import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Upload, RefreshCw, BarChart2, ShieldCheck, Zap, AlertCircle, Info, TrendingUp, Settings } from 'lucide-react';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * LOTTO GENIUS - 통계적 균형 및 비인기 조합 필터 기반 로또 번호 생성기
 * Based on user-uploaded PDF analysis.
 */

// --- Constants & Utilities ---

// 로또 공 색상 결정 함수 (한국 로또 기준)
const getBallColor = (num) => {
    if (num <= 10) return 'bg-yellow-500 border-yellow-300 shadow-yellow-500/50';
    if (num <= 20) return 'bg-blue-500 border-blue-300 shadow-blue-500/50';
    if (num <= 30) return 'bg-red-500 border-red-300 shadow-red-500/50';
    if (num <= 40) return 'bg-slate-500 border-slate-300 shadow-slate-500/50';
    return 'bg-emerald-500 border-emerald-300 shadow-emerald-500/50';
};

// 샘플 데이터 (CSV가 없을 경우를 대비한 최근 20회차 가상 데이터 - 실제로는 CSV 업로드 권장)
const MOCK_DATA = [
    [3, 7, 14, 22, 34, 42], [5, 12, 23, 31, 38, 44], [1, 9, 15, 27, 33, 40],
    [6, 11, 19, 24, 32, 45], [2, 18, 20, 29, 36, 41], [4, 8, 17, 26, 35, 43],
    [10, 13, 22, 30, 37, 42], [7, 16, 25, 28, 39, 44], [3, 14, 21, 34, 38, 45],
    [5, 12, 19, 23, 31, 40], [1, 6, 15, 27, 33, 41], [2, 9, 18, 24, 36, 43],
    [8, 11, 20, 29, 32, 42], [4, 13, 17, 26, 35, 44], [10, 16, 22, 30, 37, 45],
    [3, 7, 21, 28, 39, 40], [6, 14, 25, 34, 38, 41], [5, 12, 19, 23, 31, 43],
    [1, 9, 15, 27, 33, 42], [2, 18, 20, 29, 36, 44]
];

// --- Components ---

const LottoBall = ({ number, animate }) => {
    return (
        <div
            className={`
        w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center 
        text-white font-bold text-lg sm:text-xl border-2 shadow-lg
        ${getBallColor(number)}
        ${animate ? 'animate-bounce-short' : ''}
        transition-all duration-300 transform hover:scale-110
      `}
        >
            {number}
        </div>
    );
};

const StatCard = ({ title, value, subtext, icon: Icon, colorClass }) => (
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
    const [historyData, setHistoryData] = useState(MOCK_DATA);
    const [tolerance, setTolerance] = useState(0.05); // 2% or 5% (default 5%)
    const [generatedGames, setGeneratedGames] = useState([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [stats, setStats] = useState({ avgSum: 0, hotNumbers: [] });
    const [logs, setLogs] = useState([]); // Filtering logs
    const fileInputRef = useRef(null);

    // --- Statistics Calculation ---
    useEffect(() => {
        if (!historyData || historyData.length === 0) return;

        // 1. Calculate Average Sum
        let totalSum = 0;
        const frequency = {};

        historyData.forEach(draw => {
            const sum = draw.reduce((a, b) => a + b, 0);
            totalSum += sum;
            draw.forEach(num => {
                frequency[num] = (frequency[num] || 0) + 1;
            });
        });

        const avgSum = totalSum / historyData.length;

        // 2. Identify Top 10 Hot Numbers
        const sortedNums = Object.keys(frequency)
            .map(num => ({ num: parseInt(num), count: frequency[num] }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10)
            .map(item => item.num);

        setStats({ avgSum, hotNumbers: sortedNums });
    }, [historyData]);

    // --- Supabase Data Fetching ---
    useEffect(() => {
        const fetchLottoData = async () => {
            const { data, error } = await supabase
                .from('lotto_draws')
                .select('*')
                .order('draw_no', { ascending: true }); // Ensure chronological order

            if (error) {
                console.error('Error fetching data:', error);
                alert('데이터를 불러오는데 실패했습니다.');
            } else if (data && data.length > 0) {
                // Transform data format to match algorithm expectation: [num1, num2, ..., num6]
                // Note: Bonus number is currently not used in main logic but available in data
                const parsedData = data.map(record => [
                    record.num1, record.num2, record.num3,
                    record.num4, record.num5, record.num6
                ]);
                setHistoryData(parsedData);
            }
        };

        fetchLottoData();
    }, []);

    // --- CSV Parsing (Legacy / Backup) ---
    const handleFileUpload = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target.result;
            const lines = text.split('\n');
            const parsedData = [];

            // Simple CSV parser assuming standard lotto csv structure (often rows have date, round, then numbers)
            // We look for the first 6-7 valid numbers in each row
            lines.forEach(line => {
                const nums = line.match(/\d+/g);
                if (nums && nums.length >= 6) {
                    // Assuming the winning numbers are at the end or explicitly recognizable.
                    // Since formats vary, we'll take numbers 1-45 and pick the first 6 valid ones found in a row
                    // Or if strict format, typically cols 2-7. Let's try to filter valid 1-45 ranges.
                    const validLottoNums = nums.map(Number).filter(n => n >= 1 && n <= 45);
                    // Only accept rows that look like full draws (6+ numbers)
                    if (validLottoNums.length >= 6) {
                        // Take the first 6 unique valid numbers
                        const uniqueNums = [...new Set(validLottoNums)].slice(0, 6);
                        if (uniqueNums.length === 6) parsedData.push(uniqueNums);
                    }
                }
            });

            if (parsedData.length > 0) {
                setHistoryData(parsedData);
                alert(`${parsedData.length}회차의 당첨 데이터를 성공적으로 로드했습니다.`);
            } else {
                alert("데이터를 파싱할 수 없습니다. CSV 형식을 확인해주세요.");
            }
        };
        reader.readAsText(file);
    };

    // --- Core Algorithm (The PDF Logic) ---
    const generateLottoNumbers = async () => {
        setIsGenerating(true);
        setGeneratedGames([]);
        setLogs([]);

        // Slight delay for UI effect
        await new Promise(r => setTimeout(r, 500));

        const newGames = [];
        let attempts = 0;
        const maxAttempts = 10000; // Circuit breaker

        const targetMin = stats.avgSum * (1 - tolerance);
        const targetMax = stats.avgSum * (1 + tolerance);

        const addLog = (msg) => {
            // Keep only last 5 logs for performance
            setLogs(prev => [`[필터 작동] ${msg}`, ...prev].slice(0, 5));
        };

        while (newGames.length < 5 && attempts < maxAttempts) {
            attempts++;

            // 1. Random Generation
            const numbers = new Set();
            while (numbers.size < 6) {
                numbers.add(Math.floor(Math.random() * 45) + 1);
            }
            const candidate = Array.from(numbers).sort((a, b) => a - b);

            // --- FILTER 1: Statistical Balance (Sum) ---
            const sum = candidate.reduce((a, b) => a + b, 0);
            if (sum < targetMin || sum > targetMax) {
                if (attempts % 100 === 0) addLog(`합계범위 초과(${sum})로 폐기 (기준: ${targetMin.toFixed(0)}~${targetMax.toFixed(0)})`);
                continue;
            }

            // --- FILTER 2: Unpopular/Max Prize Strategy ---

            // 2-1. Consecutive Numbers (3+)
            let consecutiveCount = 0;
            let hasThreeConsecutive = false;
            for (let i = 0; i < candidate.length - 1; i++) {
                if (candidate[i] + 1 === candidate[i + 1]) {
                    consecutiveCount++;
                    if (consecutiveCount >= 2) hasThreeConsecutive = true; // 2 pairs means 3 numbers
                } else {
                    consecutiveCount = 0;
                }
            }
            if (hasThreeConsecutive) {
                if (attempts % 100 === 0) addLog(`3연속 번호(${candidate.join(',')}) 발견되어 폐기`);
                continue;
            }

            // 2-2. Too Many Hot Numbers (Top 10 inclusion >= 3)
            const hotCount = candidate.filter(n => stats.hotNumbers.includes(n)).length;
            if (hotCount >= 3) {
                if (attempts % 100 === 0) addLog(`인기 번호 과다(${hotCount}개)로 폐기`);
                continue;
            }

            // 2-3. Birthday Bias (All numbers <= 31)
            const allBirthday = candidate.every(n => n <= 31);
            if (allBirthday) {
                if (attempts % 100 === 0) addLog(`생일 패턴(모두 31이하) 발견되어 폐기`);
                continue;
            }

            // 2-4. Odd/Even Balance (Avoid 6:0, 0:6, 5:1, 1:5)
            const oddCount = candidate.filter(n => n % 2 !== 0).length;
            if (oddCount === 0 || oddCount === 6 || oddCount === 1 || oddCount === 5) {
                if (attempts % 100 === 0) addLog(`홀짝 불균형(${oddCount}:${6 - oddCount})으로 폐기`);
                continue;
            }

            // If all passed
            newGames.push({ numbers: candidate, sum, oddCount, hotCount });
        }

        setGeneratedGames(newGames);
        setIsGenerating(false);
    };

    return (
        <div className="min-h-screen bg-slate-900 text-slate-200 font-sans selection:bg-emerald-500 selection:text-white pb-20">
            <style>{`
        @keyframes bounce-short {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-25%); }
        }
        .animate-bounce-short {
          animation: bounce-short 0.5s ease-in-out;
        }
      `}</style>

            {/* Header */}
            <header className="bg-slate-800/50 backdrop-blur-lg border-b border-white/5 sticky top-0 z-50">
                <div className="max-w-4xl mx-auto px-6 py-4 flex justify-between items-center">
                    <div className="flex items-center space-x-2">
                        <div className="bg-gradient-to-tr from-emerald-400 to-cyan-500 p-2 rounded-lg shadow-lg shadow-emerald-500/20">
                            <Zap className="w-6 h-6 text-white" fill="currentColor" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-white tracking-tight">Lotto Genius <span className="text-emerald-400">AI</span></h1>
                            <p className="text-xs text-slate-400">통계적 균형 & 비인기 패턴 필터</p>
                        </div>
                    </div>
                    <div className="hidden sm:block text-right">
                        <div className="text-xs font-mono text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20">
                            NEXT LEVEL PREDICTION
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
                                <label className="block text-sm text-slate-400 mb-2">과거 데이터 소스</label>
                                <div className="flex space-x-2">
                                    <div className="flex-1 flex items-center justify-center space-x-2 bg-slate-800 text-slate-300 py-2 px-4 rounded-lg border border-slate-600">
                                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                        <span>Supabase DB 연동됨</span>
                                    </div>
                                    <div className="px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-xs flex items-center text-slate-400">
                                        현재: {historyData.length}회차
                                    </div>
                                </div>
                                <p className="text-xs text-slate-500 mt-2">
                                    * 자동으로 최신 당첨 번호를 불러옵니다.
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm text-slate-400 mb-2">평균 합계 허용 범위 (Tolerance)</label>
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
                                        Balanced (±5%)
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Stats Dashboard */}
                    <div className="grid grid-cols-1 gap-4">
                        <StatCard
                            title="역대 당첨번호 합계 평균"
                            value={stats.avgSum.toFixed(1)}
                            subtext={`권장 범위: ${(stats.avgSum * (1 - tolerance)).toFixed(0)} ~ ${(stats.avgSum * (1 + tolerance)).toFixed(0)}`}
                            icon={TrendingUp}
                            colorClass="bg-emerald-500"
                        />
                        <StatCard
                            title="현재 최다 빈출 번호 (HOT)"
                            value={stats.hotNumbers.slice(0, 5).join(', ')}
                            subtext="이 번호들의 과도한 조합은 피합니다"
                            icon={BarChart2}
                            colorClass="bg-orange-500"
                        />
                    </div>
                </section>

                {/* Action Button */}
                <div className="flex justify-center">
                    <button
                        onClick={generateLottoNumbers}
                        disabled={isGenerating}
                        className={`
              relative overflow-hidden group
              px-12 py-5 rounded-full font-bold text-xl tracking-wider
              text-white shadow-[0_0_40px_-10px_rgba(16,185,129,0.5)]
              transition-all duration-300 transform hover:scale-105 active:scale-95
              ${isGenerating ? 'bg-slate-700 cursor-wait' : 'bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400'}
            `}
                    >
                        <span className="relative z-10 flex items-center space-x-3">
                            {isGenerating ? (
                                <>
                                    <RefreshCw className="w-6 h-6 animate-spin" />
                                    <span>최적 조합 계산중...</span>
                                </>
                            ) : (
                                <>
                                    <Zap className="w-6 h-6" fill="currentColor" />
                                    <span>1등 예측 번호 추출</span>
                                </>
                            )}
                        </span>
                        {/* Button Shine Effect */}
                        <div className="absolute top-0 left-[-100%] w-[50%] h-full bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-[25deg] group-hover:left-[200%] transition-all duration-1000 ease-in-out"></div>
                    </button>
                </div>

                {/* Logs Area (Visible during generation) */}
                {logs.length > 0 && (
                    <div className="bg-black/30 rounded-lg p-3 text-xs font-mono text-slate-500 overflow-hidden">
                        {logs.map((log, i) => (
                            <div key={i} className="truncate">{log}</div>
                        ))}
                    </div>
                )}

                {/* Results Section */}
                {generatedGames.length > 0 && (
                    <section className="space-y-4 animate-fade-in-up">
                        <h3 className="text-xl font-bold text-white flex items-center space-x-2 border-l-4 border-emerald-500 pl-4">
                            <span>추출 결과</span>
                            <span className="text-sm font-normal text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
                                5 Games Generated
                            </span>
                        </h3>

                        <div className="grid gap-4">
                            {generatedGames.map((game, index) => (
                                <div
                                    key={index}
                                    className="bg-slate-800/80 backdrop-blur border border-slate-700 rounded-xl p-4 sm:p-6 flex flex-col sm:flex-row items-center justify-between hover:border-emerald-500/50 transition duration-300 group shadow-lg"
                                >
                                    <div className="flex items-center space-x-4 mb-4 sm:mb-0 w-full sm:w-auto justify-center">
                                        <span className="text-slate-500 font-mono text-sm mr-2">GAME {index + 1}</span>
                                        <div className="flex space-x-2 sm:space-x-3">
                                            {game.numbers.map((num) => (
                                                <LottoBall key={num} number={num} animate={true} />
                                            ))}
                                        </div>
                                    </div>

                                    <div className="flex space-x-4 text-xs sm:text-sm text-slate-400 w-full sm:w-auto justify-between sm:justify-end px-4 sm:px-0 border-t sm:border-t-0 border-slate-700 pt-3 sm:pt-0 mt-2 sm:mt-0">
                                        <div className="flex items-center space-x-1" title="총합">
                                            <TrendingUp className="w-4 h-4 text-emerald-500" />
                                            <span>합계: <span className="text-white font-bold">{game.sum}</span></span>
                                        </div>
                                        <div className="flex items-center space-x-1" title="홀짝 비율">
                                            <div className="flex space-x-0.5">
                                                <div className="w-2 h-2 rounded-full bg-white"></div>
                                                <div className="w-2 h-2 rounded-full bg-slate-600"></div>
                                            </div>
                                            <span>홀짝: <span className="text-white">{game.oddCount}:{6 - game.oddCount}</span></span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Algorithm Explanation */}
                <section className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mt-8">
                    <h4 className="text-slate-300 font-semibold mb-4 flex items-center">
                        <ShieldCheck className="w-5 h-5 mr-2 text-indigo-400" />
                        적용된 필터 알고리즘 (PDF 기반)
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-slate-400">
                        <div className="flex items-start space-x-2">
                            <div className="w-1.5 h-1.5 mt-1.5 rounded-full bg-emerald-500 shrink-0"></div>
                            <p><strong className="text-emerald-400">통계적 균형 필터:</strong> 번호 합계가 역대 평균({stats.avgSum.toFixed(0)})의 ±{(tolerance * 100).toFixed(0)}% 이내인 조합만 추출합니다.</p>
                        </div>
                        <div className="flex items-start space-x-2">
                            <div className="w-1.5 h-1.5 mt-1.5 rounded-full bg-emerald-500 shrink-0"></div>
                            <p><strong className="text-emerald-400">연속 번호 방지:</strong> 3개 이상의 연속된 숫자(예: 11,12,13)가 포함된 조합을 제외합니다.</p>
                        </div>
                        <div className="flex items-start space-x-2">
                            <div className="w-1.5 h-1.5 mt-1.5 rounded-full bg-emerald-500 shrink-0"></div>
                            <p><strong className="text-emerald-400">인기 번호 회피:</strong> 역대 최다 출현 번호(Top 10)가 3개 이상 포함되면 당첨금 분산 방지를 위해 제외합니다.</p>
                        </div>
                        <div className="flex items-start space-x-2">
                            <div className="w-1.5 h-1.5 mt-1.5 rounded-full bg-emerald-500 shrink-0"></div>
                            <p><strong className="text-emerald-400">생일 패턴 제외:</strong> 모든 번호가 31 이하인 경우(생일 찍기 패턴)를 제외하여 당첨금 극대화를 노립니다.</p>
                        </div>
                    </div>
                </section>

            </main>
        </div>
    );
}