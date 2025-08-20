// معالج API لـ Easy Order مع وظائف متقدمة
const axios = require('axios');
const fs = require('fs');

class EasyOrderAPI {
    constructor(config = {}) {
        this.baseURL = config.baseURL || process.env.EASY_ORDER_API_URL || "https://your-easyorder-domain.com/api";
        this.apiKey = config.apiKey || process.env.EASY_ORDER_API_KEY || "your-api-key";
        this.backupURL = config.backupURL || process.env.EASY_ORDER_BACKUP_URL;
        this.webhookSecret = config.webhookSecret || process.env.EASY_ORDER_WEBHOOK_SECRET;
        this.maxRetries = config.maxRetries || 3;
        this.retryDelay = config.retryDelay || 5000;
        this.timeout = config.timeout || 10000;
        
        // قائمة endpoints محتملة لتحديث حالة الطلب
        this.statusEndpoints = [
            '/orders/{orderId}/update-status',
            '/orders/{orderId}/status',
            '/order/update/{orderId}',
            '/webhook/order-status',
            '/api/orders/{orderId}/status',
            '/v1/orders/{orderId}/update',
            '/order-status-update'
        ];
        
        // إعداد axios instance
        this.client = axios.create({
            timeout: this.timeout,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'WhatsApp-Bot-Enhanced/3.0',
                'Accept': 'application/json'
            }
        });
        
        // إضافة interceptors للتسجيل
        this.client.interceptors.request.use(
            (config) => {
                console.log(`📤 API Request: ${config.method?.toUpperCase()} ${config.url}`);
                return config;
            },
            (error) => {
                console.error('❌ API Request Error:', error);
                return Promise.reject(error);
            }
        );
        
        this.client.interceptors.response.use(
            (response) => {
                console.log(`📥 API Response: ${response.status} ${response.config.url}`);
                return response;
            },
            (error) => {
                console.error(`❌ API Response Error: ${error.response?.status} ${error.config?.url}`);
                return Promise.reject(error);
            }
        );
    }
    
    // دالة لتحديث حالة الطلب مع إعادة المحاولة الذكية
    async updateOrderStatus(orderId, status, orderData = {}, retryCount = 0) {
        const updateData = {
            order_id: orderId,
            status: status,
            updated_at: new Date().toISOString(),
            notes: `تم ${status === 'confirmed' ? 'تأكيد' : 'إلغاء'} الطلب عبر WhatsApp Bot`,
            customer_phone: orderData.customerPhone,
            customer_name: orderData.customerName,
            bot_version: '3.0',
            source: 'whatsapp_bot'
        };
        
        console.log(`📤 تحديث حالة الطلب: ${orderId} -> ${status} (محاولة ${retryCount + 1})`);
        
        try {
            // محاولة الـ endpoints المختلفة
            const result = await this.tryMultipleEndpoints(orderId, updateData);
            
            if (result.success) {
                console.log(`✅ تم تحديث الطلب ${orderId} بنجاح عبر ${result.endpoint}`);
                
                // حفظ سجل النجاح
                await this.logSuccessfulUpdate(orderId, status, result.endpoint);
                
                return {
                    success: true,
                    orderId: orderId,
                    status: status,
                    endpoint: result.endpoint,
                    response: result.response
                };
            } else {
                throw new Error('فشل في جميع endpoints المتاحة');
            }
            
        } catch (error) {
            console.error(`❌ خطأ في تحديث الطلب ${orderId}:`, error.message);
            
            // إعادة المحاولة
            if (retryCount < this.maxRetries) {
                console.log(`🔄 إعادة المحاولة ${retryCount + 1}/${this.maxRetries} بعد ${this.retryDelay}ms...`);
                
                await this.delay(this.retryDelay * (retryCount + 1)); // تأخير متزايد
                return this.updateOrderStatus(orderId, status, orderData, retryCount + 1);
            } else {
                // حفظ الطلب الفاشل
                await this.logFailedUpdate(orderId, status, orderData, error.message);
                
                return {
                    success: false,
                    orderId: orderId,
                    status: status,
                    error: error.message,
                    retries: retryCount
                };
            }
        }
    }
    
    // محاولة عدة endpoints
    async tryMultipleEndpoints(orderId, updateData) {
        const urls = [this.baseURL];
        if (this.backupURL) {
            urls.push(this.backupURL);
        }
        
        for (const baseUrl of urls) {
            for (const endpoint of this.statusEndpoints) {
                try {
                    const url = baseUrl + endpoint.replace('{orderId}', orderId);
                    
                    const config = {
                        headers: {
                            'Authorization': `Bearer ${this.apiKey}`,
                            'X-API-Key': this.apiKey,
                        }
                    };
                    
                    // إضافة webhook secret إذا كان متاحاً
                    if (this.webhookSecret) {
                        config.headers['X-Webhook-Secret'] = this.webhookSecret;
                    }
                    
                    const response = await this.client.post(url, updateData, config);
                    
                    if (response.status >= 200 && response.status < 300) {
                        return {
                            success: true,
                            endpoint: url,
                            response: response.data
                        };
                    }
                    
                } catch (endpointError) {
                    console.log(`⚠️ فشل endpoint ${baseUrl + endpoint}: ${endpointError.message}`);
                    continue;
                }
            }
        }
        
        return { success: false };
    }
    
    // دالة لاختبار الاتصال بـ API
    async testConnection() {
        const testEndpoints = [
            '/health',
            '/status',
            '/ping',
            '/orders',
            '/'
        ];
        
        console.log('🔍 اختبار الاتصال بـ Easy Order API...');
        
        for (const endpoint of testEndpoints) {
            try {
                const url = this.baseURL + endpoint;
                const response = await this.client.get(url, {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'X-API-Key': this.apiKey
                    },
                    timeout: 5000
                });
                
                if (response.status >= 200 && response.status < 300) {
                    console.log(`✅ اتصال ناجح عبر ${url}`);
                    return {
                        success: true,
                        endpoint: url,
                        status: response.status,
                        data: response.data
                    };
                }
                
            } catch (error) {
                console.log(`❌ فشل الاتصال عبر ${endpoint}: ${error.message}`);
                continue;
            }
        }
        
        return {
            success: false,
            message: 'فشل في الاتصال بجميع endpoints'
        };
    }
    
    // دالة لاستخراج معلومات API من الاستجابات
    async discoverAPIStructure() {
        console.log('🔍 محاولة اكتشاف هيكل Easy Order API...');
        
        const discoveryEndpoints = [
            '/docs',
            '/swagger',
            '/api-docs',
            '/documentation',
            '/openapi.json',
            '/swagger.json'
        ];
        
        const results = [];
        
        for (const endpoint of discoveryEndpoints) {
            try {
                const url = this.baseURL + endpoint;
                const response = await this.client.get(url, {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'X-API-Key': this.apiKey
                    },
                    timeout: 5000
                });
                
                if (response.status === 200) {
                    results.push({
                        endpoint: url,
                        contentType: response.headers['content-type'],
                        data: response.data
                    });
                    
                    console.log(`✅ وجد وثائق API في ${url}`);
                }
                
            } catch (error) {
                continue;
            }
        }
        
        // حفظ النتائج
        if (results.length > 0) {
            try {
                fs.writeFileSync('api_discovery.json', JSON.stringify(results, null, 2));
                console.log('💾 تم حفظ معلومات API في api_discovery.json');
            } catch (saveError) {
                console.error('❌ خطأ في حفظ معلومات API:', saveError);
            }
        }
        
        return results;
    }
    
    // دالة لتسجيل التحديثات الناجحة
    async logSuccessfulUpdate(orderId, status, endpoint) {
        const logEntry = {
            orderId: orderId,
            status: status,
            endpoint: endpoint,
            timestamp: new Date().toISOString(),
            success: true
        };
        
        try {
            let logs = [];
            if (fs.existsSync('successful_updates.json')) {
                logs = JSON.parse(fs.readFileSync('successful_updates.json', 'utf8'));
            }
            
            logs.push(logEntry);
            
            // الاحتفاظ بآخر 1000 سجل فقط
            if (logs.length > 1000) {
                logs = logs.slice(-1000);
            }
            
            fs.writeFileSync('successful_updates.json', JSON.stringify(logs, null, 2));
        } catch (error) {
            console.error('❌ خطأ في تسجيل التحديث الناجح:', error);
        }
    }
    
    // دالة لتسجيل التحديثات الفاشلة
    async logFailedUpdate(orderId, status, orderData, errorMessage) {
        const logEntry = {
            orderId: orderId,
            status: status,
            orderData: orderData,
            error: errorMessage,
            timestamp: new Date().toISOString(),
            success: false
        };
        
        try {
            let failedLogs = [];
            if (fs.existsSync('failed_updates.json')) {
                failedLogs = JSON.parse(fs.readFileSync('failed_updates.json', 'utf8'));
            }
            
            failedLogs.push(logEntry);
            fs.writeFileSync('failed_updates.json', JSON.stringify(failedLogs, null, 2));
            
            console.log(`💾 تم حفظ الطلب الفاشل ${orderId} للمعالجة اليدوية`);
        } catch (error) {
            console.error('❌ خطأ في حفظ الطلب الفاشل:', error);
        }
    }
    
    // دالة لإعادة معالجة الطلبات الفاشلة
    async retryFailedUpdates() {
        try {
            if (!fs.existsSync('failed_updates.json')) {
                console.log('📝 لا توجد طلبات فاشلة لإعادة المعالجة');
                return { processed: 0, successful: 0, failed: 0 };
            }
            
            const failedUpdates = JSON.parse(fs.readFileSync('failed_updates.json', 'utf8'));
            console.log(`🔄 إعادة معالجة ${failedUpdates.length} طلب فاشل...`);
            
            let successful = 0;
            let failed = 0;
            const stillFailed = [];
            
            for (const update of failedUpdates) {
                try {
                    const result = await this.updateOrderStatus(
                        update.orderId, 
                        update.status, 
                        update.orderData
                    );
                    
                    if (result.success) {
                        successful++;
                        console.log(`✅ نجح إعادة معالجة الطلب ${update.orderId}`);
                    } else {
                        failed++;
                        stillFailed.push(update);
                    }
                    
                    // تأخير بين الطلبات
                    await this.delay(1000);
                    
                } catch (error) {
                    failed++;
                    stillFailed.push(update);
                    console.error(`❌ فشل إعادة معالجة الطلب ${update.orderId}:`, error.message);
                }
            }
            
            // تحديث ملف الطلبات الفاشلة
            fs.writeFileSync('failed_updates.json', JSON.stringify(stillFailed, null, 2));
            
            console.log(`📊 نتائج إعادة المعالجة: ${successful} نجح، ${failed} فشل`);
            
            return {
                processed: failedUpdates.length,
                successful: successful,
                failed: failed,
                remaining: stillFailed.length
            };
            
        } catch (error) {
            console.error('❌ خطأ في إعادة معالجة الطلبات الفاشلة:', error);
            return { error: error.message };
        }
    }
    
    // دالة للحصول على إحصائيات API
    getStats() {
        const stats = {
            successful: 0,
            failed: 0,
            lastUpdate: null,
            endpoints: this.statusEndpoints.length
        };
        
        try {
            if (fs.existsSync('successful_updates.json')) {
                const successful = JSON.parse(fs.readFileSync('successful_updates.json', 'utf8'));
                stats.successful = successful.length;
                if (successful.length > 0) {
                    stats.lastSuccessful = successful[successful.length - 1].timestamp;
                }
            }
            
            if (fs.existsSync('failed_updates.json')) {
                const failed = JSON.parse(fs.readFileSync('failed_updates.json', 'utf8'));
                stats.failed = failed.length;
                if (failed.length > 0) {
                    stats.lastFailed = failed[failed.length - 1].timestamp;
                }
            }
        } catch (error) {
            console.error('❌ خطأ في قراءة الإحصائيات:', error);
        }
        
        return stats;
    }
    
    // دالة مساعدة للتأخير
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = EasyOrderAPI;

