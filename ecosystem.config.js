module.exports = {
  apps: [
    {
      name: 'ota-api', // 应用名称
      script: './dist/main.js', // 编译后的 NestJS 入口文件 [2]
      instances: 'max', // 开启集群模式，'max'代表使用所有 CPU 核心 [9]
      exec_mode: 'cluster', // 模式：cluster（集群）或 fork（单实例）

      // // 环境变量
      // env: {
      //   NODE_ENV: 'development' // 默认开发环境
      // },
      // env_production: {
      //   NODE_ENV: 'production', // 生产环境 [10]
      //   PORT: 3000 // 应用端口
      // },

      // 进程管理
      autorestart: true, // 应用崩溃后自动重启 [9]
      watch: false, // 生产环境不建议开启监听文件变动
      max_memory_restart: '1G', // 内存超过1G自动重启 [9]

      // 日志记录
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/err.log', // 错误日志文件
      out_file: './logs/out.log' // 标准日志文件
    }
  ]
}
