const express = require('express');
const bodyParser = require('body-parser');
const { exec } = require('child_process');
const schedule = require('node-schedule');
const cors = require('cors');
const app = express();

// 配置
const PORT = 3000;
let shutdownJob = null;
let scheduledConfig = null;

// 中间件
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));

// 计算目标时间
function calculateTargetTime(config) {
    const now = new Date();
    const target = new Date();
    
    target.setHours(config.hour);
    target.setMinutes(config.minute);
    target.setSeconds(0);
    target.setMilliseconds(0);
    
    // 如果目标时间已过
    if (target < now) {
        if (config.repeat === 'once') {
            // 单次任务，调整到明天
            target.setDate(target.getDate() + 1);
        } else if (config.repeat === 'daily') {
            // 每日任务，调整到明天
            target.setDate(target.getDate() + 1);
        }
    }
    
    // 每月任务特殊处理
    if (config.repeat === 'monthly') {
        const day = parseInt(config.monthDay);
        target.setDate(day);
        
        // 如果本月日期已过，调整到下个月
        if (target < now) {
            target.setMonth(target.getMonth() + 1);
            target.setDate(day);
        }
    }
    
    return target;
}

// 格式化时间
function formatDateTime(date) {
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

// 格式化倒计时
function formatCountdown(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// 执行关机命令
function executeShutdown() {
    // Windows关机命令（60秒后关机）
    exec('shutdown /s /t 60', (error, stdout, stderr) => {
        if (error) {
            console.error(`执行关机命令失败: ${error}`);
            return;
        }
        console.log('关机命令已执行');
    });
}

// 设置定时关机
app.post('/set-shutdown', (req, res) => {
    try {
        // 验证参数
        const { hour, minute, repeat, monthDay } = req.body;
        
        if (!hour || !minute || !repeat) {
            return res.json({
                success: false,
                message: '参数不完整'
            });
        }
        
        // 取消现有任务
        if (shutdownJob) {
            shutdownJob.cancel();
        }
        
        // 构建配置
        scheduledConfig = {
            hour: parseInt(hour),
            minute: parseInt(minute),
            repeat,
            monthDay: repeat === 'monthly' ? monthDay : null
        };
        
        // 计算目标时间
        const targetTime = calculateTargetTime(scheduledConfig);
        
        // 创建定时任务
        if (repeat === 'once') {
            // 单次任务
            shutdownJob = schedule.scheduleJob(targetTime, executeShutdown);
        } else if (repeat === 'daily') {
            // 每日任务
            shutdownJob = schedule.scheduleJob(`0 ${minute} ${hour} * * *`, executeShutdown);
        } else if (repeat === 'monthly') {
            // 每月任务
            shutdownJob = schedule.scheduleJob(`0 ${minute} ${hour} ${monthDay} * *`, executeShutdown);
        }
        
        // 构建重复文本
        let repeatText = '';
        if (repeat === 'once') repeatText = '仅一次';
        else if (repeat === 'daily') repeatText = '每天';
        else if (repeat === 'monthly') repeatText = `每月${monthDay}日`;
        
        res.json({
            success: true,
            targetTime: formatDateTime(targetTime),
            repeatText
        });
        
    } catch (error) {
        res.json({
            success: false,
            message: error.message
        });
    }
});

// 取消定时关机
app.post('/cancel-shutdown', (req, res) => {
    try {
        // 取消定时任务
        if (shutdownJob) {
            shutdownJob.cancel();
            shutdownJob = null;
        }
        
        // 取消系统关机命令
        exec('shutdown /a 2>nul', (error) => {
            if (error) {
                console.log('没有待取消的关机任务');
            }
        });
        
        scheduledConfig = null;
        
        res.json({
            success: true
        });
        
    } catch (error) {
        res.json({
            success: false,
            message: error.message
        });
    }
});

// 立即关机
app.post('/immediate-shutdown', (req, res) => {
    try {
        // 立即关机命令
        exec('shutdown /s /t 0', (error, stdout, stderr) => {
            if (error) {
                return res.json({
                    success: false,
                    message: '执行关机命令失败，请以管理员身份运行'
                });
            }
            res.json({
                success: true
            });
        });
        
    } catch (error) {
        res.json({
            success: false,
            message: error.message
        });
    }
});

// 获取状态
app.get('/status', (req, res) => {
    if (!scheduledConfig) {
        return res.json({
            success: true,
            scheduled: false
        });
    }
    
    const targetTime = calculateTargetTime(scheduledConfig);
    let repeatText = '';
    
    if (scheduledConfig.repeat === 'once') repeatText = '仅一次';
    else if (scheduledConfig.repeat === 'daily') repeatText = '每天';
    else if (scheduledConfig.repeat === 'monthly') repeatText = `每月${scheduledConfig.monthDay}日`;
    
    res.json({
        success: true,
        scheduled: true,
        targetTime: formatDateTime(targetTime),
        repeatText
    });
});

// 获取倒计时
app.get('/countdown', (req, res) => {
    if (!scheduledConfig) {
        return res.json({
            success: false,
            message: '未设置定时关机'
        });
    }
    
    const now = new Date();
    const targetTime = calculateTargetTime(scheduledConfig);
    const diff = Math.max(0, Math.floor((targetTime - now) / 1000));
    
    res.json({
        success: true,
        countdown: formatCountdown(diff)
    });
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    console.log('请在浏览器中打开上述地址使用程序');
    
    // 自动打开浏览器
    exec(`start http://localhost:${PORT}`);
});