module.exports = {
  apps: [
    {
      name: 'ota-api', // 应用名称
      script: './dist/main.js', // 编译后的 NestJS 入口文件
      instances: 1, // 开启集群模式，'max'代表使用所有 CPU 核心，`1`代表单实例
      // 连接订阅索引位于进程内存，使用单实例。
      exec_mode: 'fork', // 模式：cluster（集群）或 fork（单实例）

      // 进程管理
      autorestart: true, // 应用崩溃后自动重启
      watch: false, // 生产环境不建议开启监听文件变动
      max_memory_restart: '1G', // 内存超过1G自动重启

      // 日志记录
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/err.log', // 错误日志文件
      out_file: './logs/out.log' // 标准日志文件
    }
  ]
}
