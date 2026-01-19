import { useState, useEffect, useRef } from 'react'
import sdk from '@farcaster/frame-sdk'
import { 
  useAccount, 
  useConnect, 
  useDisconnect, 
  useWriteContract, 
  useWaitForTransactionReceipt,
  useEnsName
} from 'wagmi'
import { parseUnits } from 'viem'
import Phaser from 'phaser'
import GameScene from './game/GameScene'

const ADMIN_ADDRESS = '0x1FE0D4089D100B30263c83A82a25987e2cdaD715'
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const RECEIVER_ADDRESS = ADMIN_ADDRESS
const ENTRY_FEE = '10'
const API_URL = '/api'

const USDC_ABI = [
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const

interface LeaderboardEntry {
  walletAddress: string
  score: number
}

interface GameStats {
  remainingSpots: number | string
  totalSpots: number | string
  totalPlayers: number | string
  totalPool: string
}

type View = 'menu' | 'playing' | 'gameover' | 'leaderboard' | 'paying'

function PlayerName({ address }: { address: string }) {
  const { data: ensName } = useEnsName({
    address: address as `0x${string}`,
  })
  const shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`
  return <span>{ensName || shortAddress}</span>
}

export default function App() {
  const { address, isConnected } = useAccount()
  const { connectors, connect, error: connectError } = useConnect()
  const { disconnect } = useDisconnect()
  const { writeContractAsync } = useWriteContract()
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const { isLoading: isWaitingForTx, isSuccess: isTxSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  const [view, setView] = useState<View>('menu')
  const [mode, setMode] = useState<'Practice' | 'Competition'>('Practice')
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [stats, setStats] = useState<GameStats>({ 
    remainingSpots: '...', 
    totalSpots: '...',
    totalPlayers: '...',
    totalPool: '$15,000 USD'
  })
  const [currentScore, setCurrentScore] = useState(0)
  const [highScore, setHighScore] = useState<number>(() => {
    const saved = localStorage.getItem('highScore')
    return saved ? parseInt(saved) : 0
  })
  const [hasPaid, setHasPaid] = useState(false)

  const gameRef = useRef<Phaser.Game | null>(null)

  useEffect(() => {
    const load = async () => {
      await sdk.actions.ready()
    }
    load()
  }, [])

  useEffect(() => {
    if (connectError) alert(`Connection failed: ${connectError.message}`)
  }, [connectError])

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_URL}/stats`)
      const data = await res.json()
      setStats(prev => ({ ...prev, ...data }))
    } catch {
      setStats(prev => ({ ...prev, remainingSpots: 0, totalSpots: 0, totalPlayers: 0 }))
    }
  }

  const fetchLeaderboard = async () => {
    try {
      const res = await fetch(`${API_URL}/leaderboard`)
      const data = await res.json()
      setLeaderboard(data)
    } catch (error) {
      console.error('Failed to fetch leaderboard:', error)
    }
  }

  useEffect(() => {
    const init = async () => { await fetchStats() }
    init()
    const interval = setInterval(fetchStats, 2000)
    return () => clearInterval(interval)
  }, [API_URL])

  useEffect(() => {
    if (view === 'leaderboard') {
      const loadLB = async () => { await fetchLeaderboard() }
      loadLB()
    }
  }, [view])

  useEffect(() => {
    if (isTxSuccess && view === 'paying') {
      const timer = setTimeout(() => {
        setHasPaid(true)
        setView('playing')
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [isTxSuccess, view])

  const checkPaymentStatus = async (addr: string) => {
    try {
      const res = await fetch(`${API_URL}/check-payment?walletAddress=${addr}`)
      const data = await res.json()
      return data.isPaid
    } catch { return false }
  }

  const handlePay = async () => {
    setView('paying')
    try {
      const hash = await writeContractAsync({
        address: USDC_ADDRESS,
        abi: USDC_ABI,
        functionName: 'transfer',
        args: [RECEIVER_ADDRESS, parseUnits(ENTRY_FEE, 6)],
      })
      setTxHash(hash)
      
      await fetch(`${API_URL}/record-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: address, txHash: hash }),
      })
    } catch (error) {
      console.error('Payment failed:', error)
      alert("Payment Cancelled")
      setView('menu')
    }
  }

  const handleCompetitionClick = async () => {
    if (!isConnected) {
      const connector = connectors.find(c => c.id === 'injected' || c.id === 'coinbaseWallet') || connectors[0]
      return connect({ connector })
    }
    
    setMode('Competition')
    if (hasPaid) {
      setView('playing')
      return
    }

    const paid = await checkPaymentStatus(address!)
    if (paid) {
      setHasPaid(true)
      setView('playing')
      return
    }

    await handlePay()
  }

  const getReward = (rank: number): number => {
    if (rank === 1) return 1000
    if (rank === 2) return 550
    if (rank === 3) return 350
    if (rank >= 4 && rank <= 10) return 150
    if (rank >= 11 && rank <= 50) return 60
    if (rank >= 51 && rank <= 250) return 50
    return 0
  }

  const downloadCSV = () => {
    const topRanked = leaderboard.slice(0, 250)
    let csvContent = "Rank,Wallet_Address,Points,Reward_USDC\n"
    topRanked.forEach((entry: LeaderboardEntry, i: number) => {
      const rank = i + 1
      csvContent += `${rank},${entry.walletAddress},${entry.score},${getReward(rank)}\n`
    })
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement("a")
    const url = URL.createObjectURL(blob)
    link.setAttribute("href", url)
    link.setAttribute("download", "flappy-base-rewards.csv")
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  useEffect(() => {
    if (view === 'playing' && !gameRef.current) {
      const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        parent: 'game-container',
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
          width: 800,
          height: 600
        },
        physics: {
          default: 'arcade',
          arcade: { gravity: { x: 0, y: 0 }, debug: false },
        },
        scene: GameScene,
        backgroundColor: '#70c5ce',
      }

      const gameInstance = new Phaser.Game(config) as Phaser.Game & { handleGameOver: (score: number) => void }
      
      gameInstance.handleGameOver = async (score: number) => {
        setCurrentScore(score)
        if (score > highScore) {
          setHighScore(score)
          localStorage.setItem('highScore', score.toString())
        }
        if (isConnected && mode === 'Competition') {
          await fetch(`${API_URL}/update-score`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ walletAddress: address, score }),
          })
          fetchStats()
        }
        const timer = setTimeout(() => { setView('gameover') }, 0)
        return () => clearTimeout(timer)
      }

      gameInstance.events.on('ready', () => {
        gameInstance.scene.start('GameScene', { walletAddress: address, mode })
      })

      gameRef.current = gameInstance
    }

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true)
        gameRef.current = null
      }
    }
  }, [view, mode, address, highScore, isConnected])

  const renderMenu = () => (
    <div className="relative flex flex-col items-center justify-center min-h-screen w-full city-background p-4 text-center overflow-hidden">
      <div className="relative z-10 flex flex-col items-center max-w-lg w-full">
        {!isConnected ? (
          <>
            <div className="relative mb-20">
              <img src="/assets/mario.jpg" alt="Mario" className="mario-sit" />
              <h1 className="text-4xl md:text-6xl font-black text-white text-stroke pixel-font leading-tight">FLAPPY BASE</h1>
              <img src="/assets/Jesse-Pollak.jpg" alt="Jesse Pollak" className="jesse-float" />
            </div>
            <button onClick={() => { const connector = connectors.find(c => c.id === 'injected' || c.id === 'coinbaseWallet') || connectors[0]; connect({ connector }); }} className="pixel-button pixel-button-primary pixel-font text-xl px-12 py-6">
              CONNECT WALLET
            </button>
          </>
        ) : (
          <>
            <button onClick={() => disconnect()} className="fixed top-4 right-4 pixel-button text-[10px] bg-red-600 border-red-800 text-white">
              DISCONNECT [{address?.slice(0, 6)}...]
            </button>
            <div className="relative mb-4">
              <img src="/assets/mario.jpg" alt="Mario" className="mario-sit" />
              <h1 className="text-4xl md:text-6xl font-black text-white text-stroke pixel-font leading-tight">FLAPPY BASE</h1>
              <img src="/assets/Jesse-Pollak.jpg" alt="Jesse Pollak" className="jesse-float" />
            </div>
            <h2 className="text-xl font-bold mb-10 cyber-blue pixel-font tracking-widest uppercase">BASE MAINNET</h2>
            <div className="grid grid-cols-2 gap-4 w-full mb-12 pixel-font text-[10px] text-white">
              <div className="stat-box">
                <span className="stat-label">💰 POOL</span>
                <span>$15,000 USD</span>
              </div>
              <div className="stat-box">
                <span className="stat-label pulse-red">🎟️ SPOTS FILLED</span>
                <span>{stats.remainingSpots} / 2000</span>
              </div>
            </div>
            <div className="space-y-6 w-full max-w-xs">
              <button onClick={() => { setMode('Practice'); setView('playing') }} className="w-full pixel-button pixel-button-secondary text-sm">PRACTICE</button>
              <button onClick={handleCompetitionClick} className="w-full pixel-button pixel-button-retro text-sm">COMPETE ($10)</button>
            </div>
            <button onClick={() => setView('leaderboard')} className="mt-12 text-[10px] text-white/40 hover:text-white pixel-font underline">HALL OF FAME</button>
          </>
        )}
      </div>
      <footer className="fixed bottom-8 text-[8px] opacity-40 pixel-font text-white">Made by Dr. Acay</footer>
    </div>
  )

  const renderGameOver = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
      <div className="pixel-modal p-8 max-w-xs w-full text-center">
        <h2 className="text-2xl font-black mb-8 text-red-500 pixel-font">GAME OVER</h2>
        <div className="space-y-4 mb-10">
          <div><p className="text-[10px] text-white/40 pixel-font mb-2">SCORE</p><p className="text-3xl font-black pixel-font">{currentScore}</p></div>
          <div><p className="text-[10px] text-white/40 pixel-font mb-2">BEST</p><p className="text-xl font-black text-yellow-400 pixel-font">{highScore}</p></div>
        </div>
        <button onClick={() => { if (gameRef.current) { gameRef.current.destroy(true); gameRef.current = null; } setView('playing') }} className="w-full pixel-button pixel-button-primary text-xs mb-4">RETRY</button>
        <button onClick={() => { if (gameRef.current) { gameRef.current.destroy(true); gameRef.current = null; } setView('menu') }} className="text-[10px] text-white/40 hover:text-white pixel-font">BACK TO MENU</button>
      </div>
    </div>
  )

  const renderPaying = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black p-6 text-center">
      <div className="max-w-xs w-full">
        <h2 className="text-xl font-black mb-8 pixel-font text-white">PAYING $10 USDC</h2>
        <div className="animate-pulse space-y-6 text-white/60 pixel-font text-xs">
          <p>{isWaitingForTx ? 'CONFIRMING TX...' : 'WAITING FOR WALLET...'}</p>
          <div className="h-2 bg-white/20 w-full rounded-full overflow-hidden"><div className="h-full bg-blue-500 animate-[loading_2s_infinite]" /></div>
        </div>
      </div>
    </div>
  )

  const renderLeaderboard = () => (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 overflow-y-auto">
      <div className="leaderboard-modal max-w-2xl w-full">
        <div className="leaderboard-inner">
          <button onClick={() => setView('menu')} className="close-x pixel-font">X</button>
          <h2 className="text-2xl md:text-4xl arcade-header pixel-font uppercase">HALL OF FAME</h2>
          {address === ADMIN_ADDRESS && (
            <button onClick={downloadCSV} className="w-full mb-8 pixel-button pixel-button-primary text-[10px]">DOWNLOAD REWARDS CSV</button>
          )}
          <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar">
            {leaderboard.map((entry, i) => {
              const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : ''
              return (
                <div key={i} className={`leaderboard-item text-[10px] md:text-sm pixel-font ${rankClass}`}>
                  <div className="leaderboard-info">
                    <span className="mr-4 w-8">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</span>
                    <img src={`https://effigy.im/a/${entry.walletAddress}.png`} alt="avatar" className="leaderboard-pfp" />
                    <PlayerName address={entry.walletAddress} />
                  </div>
                  <span>{entry.score} PTS</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen relative flex flex-col items-center justify-center bg-[#70c5ce]">
      {view === 'menu' && renderMenu()}
      {view === 'paying' && renderPaying()}
      {view === 'leaderboard' && renderLeaderboard()}
      {(view === 'playing' || view === 'gameover') && (
        <div id="game-container" className="fixed inset-0 w-screen h-screen flex items-center justify-center" />
      )}
      {view === 'gameover' && renderGameOver()}
    </div>
  )
}
