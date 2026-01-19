import Phaser from 'phaser';

export default class GameScene extends Phaser.Scene {
  private bird!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private pipes!: Phaser.Physics.Arcade.Group;
  private bg!: Phaser.GameObjects.TileSprite;
  private base!: Phaser.GameObjects.TileSprite;
  private score: number = 0;
  private scoreText!: Phaser.GameObjects.Text;
  private isGameOver: boolean = false;
  private walletAddress: string = '';
  private mode: 'Practice' | 'Competition' = 'Practice';
  private baseHeight: number = 112;

  constructor() {
    super('GameScene');
  }

  init(data: { walletAddress: string; mode: 'Practice' | 'Competition' }) {
    this.walletAddress = data.walletAddress;
    this.mode = data.mode;
    this.score = 0;
    this.isGameOver = false;
  }

  preload() {
    this.load.image('bird', '/assets/bird.png');
    this.load.image('pipe', '/assets/pipe.png');
    this.load.image('bg', '/assets/bg.png');
    this.load.image('base', '/assets/base.png');

    this.load.audio('flap', '/assets/flap.mp3');
    this.load.audio('swoosh', '/assets/swoosh.mp3');
    this.load.audio('hit', '/assets/flappy-bird-hit-sound.mp3');
    this.load.audio('point', '/assets/point.mp3');
    this.load.audio('die', '/assets/die.mp3');
  }

  create() {
    const { width, height } = this.sys.game.canvas;
    
    this.sound.play('swoosh');

    this.bg = this.add.tileSprite(0, 0, width, height, 'bg').setOrigin(0, 0);
    this.bg.setScrollFactor(0);

    this.physics.world.gravity.y = 1000;
    this.pipes = this.physics.add.group();

    this.bird = this.physics.add.sprite(100, height / 2, 'bird');
    this.bird.setCollideWorldBounds(true);
    this.bird.setScale(1.5);
    this.bird.setDepth(10);

    this.base = this.add.tileSprite(0, height - this.baseHeight, width, this.baseHeight, 'base').setOrigin(0, 0);
    this.base.setDepth(20);
    this.physics.add.existing(this.base, true);

    this.input.on('pointerdown', () => this.flap());
    this.input.keyboard?.on('keydown-SPACE', () => this.flap());

    this.scoreText = this.add.text(16, 16, '0', {
      fontSize: '40px',
      color: '#fff',
      fontFamily: '"Press Start 2P"',
      stroke: '#000',
      strokeThickness: 6
    }).setDepth(30);

    this.time.addEvent({
      delay: 1500,
      callback: this.addPipeGroup,
      callbackScope: this,
      loop: true
    });

    this.physics.add.collider(this.bird, this.pipes, this.hitObstacle, undefined, this);
    this.physics.add.collider(this.bird, this.base, this.hitObstacle, undefined, this);
  }

  update() {
    if (this.isGameOver) return;
    this.bg.tilePositionX += 0.5;
    this.base.tilePositionX += 2;
    if (this.bird.y < 0) this.hitObstacle();
  }

  flap() {
    if (this.isGameOver) return;
    
    // Direct context resume to unlock audio on first interaction
    const soundManager = this.sound as Phaser.Sound.WebAudioSoundManager;
    if (soundManager.context && soundManager.context.state === 'suspended') {
      soundManager.context.resume();
    }

    this.bird.setVelocityY(-350);
    this.sound.play('flap');
  }

  addPipeGroup() {
    if (this.isGameOver) return;
    const gap = 160;
    const x = this.sys.game.canvas.width + 50;
    const minY = 100;
    const maxY = this.sys.game.canvas.height - this.baseHeight - gap - 100;
    const gapTop = Phaser.Math.Between(minY, maxY);
    const gapBottom = gapTop + gap;
    this.addPipe(x, gapTop, true);
    this.addPipe(x, gapBottom, false);
  }

  addPipe(x: number, y: number, isTop: boolean) {
    const pipe = this.pipes.create(x, y, 'pipe') as Phaser.Physics.Arcade.Sprite;
    this.physics.add.existing(pipe);
    if (pipe.body) {
      (pipe.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
      (pipe.body as Phaser.Physics.Arcade.Body).setImmovable(true);
    }
    pipe.setVelocityX(-200);

    if (isTop) {
      pipe.setOrigin(0.5, 1);
      pipe.setFlipY(true);
      pipe.displayHeight = y; 
    } else {
      pipe.setOrigin(0.5, 0);
      pipe.displayHeight = this.sys.game.canvas.height - y - this.baseHeight;
    }

    if (!isTop) {
      this.time.addEvent({
        delay: 10,
        callback: () => {
          if (!this.isGameOver && pipe && pipe.x < this.bird.x && !pipe.getData('scored')) {
            pipe.setData('scored', true);
            this.score += 1;
            this.scoreText.setText(`${this.score}`);
            this.sound.play('point');
          }
        },
        loop: true
      });
    }
  }

  hitObstacle() {
    if (this.isGameOver) return;
    this.isGameOver = true;
    this.physics.pause();
    this.bird.setTint(0xff0000);
    
    this.sound.play('hit');
    this.time.delayedCall(200, () => {
        this.sound.play('die');
    });

    const finalScore = this.score;
    if (this.mode === 'Competition') this.submitScore(finalScore);

    this.time.delayedCall(500, () => {
        const gameInstance = this.game as Phaser.Game & { handleGameOver: (score: number) => void };
        if (gameInstance.handleGameOver) {
            gameInstance.handleGameOver(finalScore);
        }
    });
  }

  async submitScore(score: number) {
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    try {
      await fetch(`${API_URL}/submit-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: this.walletAddress, score }),
      });
    } catch (error) {
      console.error('Error submitting score:', error);
    }
  }
}
