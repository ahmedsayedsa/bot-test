// سكريبت اختبار شامل لبوت واتساب
const axios = require('axios');
const fs = require('fs');

class WhatsAppBotTester {
    constructor(baseURL = 'http://localhost:3000') {
        this.baseURL = baseURL;
        this.testResults = [];
    }
    
    // دالة لاختبار حالة الخادم
    async testServerHealth() {
        console.log('🔍 اختبار حالة الخادم...');
        
        try {
            const response = await axios.get(`${this.baseURL}/health`, {
                timeout: 5000
            });
            
            const result = {
                test: 'Server Health',
                success: true,
                status: response.status,
                data: response.data
            };
            
            console.log('✅ الخادم يعمل بنجاح');
            console.log('📊 معلومات الخادم:', JSON.stringify(response.data, null, 2));
            
            this.testResults.push(result);
            return result;
            
        } catch (error) {
            const result = {
                test: 'Server Health',
                success: false,
                error: error.message
            };
            
            console.log('❌ فشل في الاتصال بالخادم:', error.message);
            this.testResults.push(result);
            return result;
        }
    }
    
    // دالة لاختبار الصفحة الرئيسية
    async testHomePage() {
        console.log('🔍 اختبار الصفحة الرئيسية...');
        
        try {
            const response = await axios.get(this.baseURL, {
                timeout: 5000
            });
            
            const result = {
                test: 'Home Page',
                success: true,
                status: response.status,
                contentType: response.headers['content-type'],
                hasQR: response.data.includes('QR') || response.data.includes('qr'),
                isConnected: response.data.includes('متصل') || response.data.includes('connected')
            };
            
            console.log('✅ الصفحة الرئيسية تعمل');
            console.log(`📊 حالة الاتصال: ${result.isConnected ? 'متصل' : 'غير متصل'}`);
            
            this.testResults.push(result);
            return result;
            
        } catch (error) {
            const result = {
                test: 'Home Page',
                success: false,
                error: error.message
            };
            
            console.log('❌ فشل في تحميل الصفحة الرئيسية:', error.message);
            this.testResults.push(result);
            return result;
        }
    }
    
    // دالة لاختبار إرسال طلب وهمي
    async testSendOrder() {
        console.log('🔍 اختبار إرسال طلب وهمي...');
        
        const testOrder = {
            order_id: 'TEST_' + Date.now(),
            customer_name: 'أحمد محمد',
            customer_phone: '201234567890',
            total: 250,
            address: 'القاهرة، مصر الجديدة',
            items: [
                {
                    name: 'منتج تجريبي 1',
                    price: 100,
                    quantity: 1
                },
                {
                    name: 'منتج تجريبي 2',
                    price: 150,
                    quantity: 1
                }
            ]
        };
        
        try {
            const response = await axios.post(`${this.baseURL}/send-order`, testOrder, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });
            
            const result = {
                test: 'Send Order',
                success: true,
                status: response.status,
                data: response.data,
                orderId: testOrder.order_id
            };
            
            console.log('✅ تم إرسال الطلب بنجاح');
            console.log('📊 استجابة الخادم:', JSON.stringify(response.data, null, 2));
            
            this.testResults.push(result);
            return result;
            
        } catch (error) {
            const result = {
                test: 'Send Order',
                success: false,
                error: error.message,
                status: error.response?.status,
                data: error.response?.data
            };
            
            console.log('❌ فشل في إرسال الطلب:', error.message);
            if (error.response?.data) {
                console.log('📊 تفاصيل الخطأ:', JSON.stringify(error.response.data, null, 2));
            }
            
            this.testResults.push(result);
            return result;
        }
    }
    
    // دالة لاختبار عرض الطلبات المعلقة
    async testPendingOrders() {
        console.log('🔍 اختبار عرض الطلبات المعلقة...');
        
        try {
            const response = await axios.get(`${this.baseURL}/pending-orders`, {
                timeout: 5000
            });
            
            const result = {
                test: 'Pending Orders',
                success: true,
                status: response.status,
                count: response.data.count,
                orders: response.data.orders
            };
            
            console.log('✅ تم جلب الطلبات المعلقة بنجاح');
            console.log(`📊 عدد الطلبات المعلقة: ${response.data.count}`);
            
            this.testResults.push(result);
            return result;
            
        } catch (error) {
            const result = {
                test: 'Pending Orders',
                success: false,
                error: error.message
            };
            
            console.log('❌ فشل في جلب الطلبات المعلقة:', error.message);
            this.testResults.push(result);
            return result;
        }
    }
    
    // دالة لاختبار إرسال رسالة تجريبية
    async testSendMessage() {
        console.log('🔍 اختبار إرسال رسالة تجريبية...');
        
        const testMessage = {
            phone: '201234567890',
            message: 'هذه رسالة تجريبية من بوت واتساب 🤖',
            withButtons: true
        };
        
        try {
            const response = await axios.post(`${this.baseURL}/test-send`, testMessage, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });
            
            const result = {
                test: 'Send Test Message',
                success: true,
                status: response.status,
                data: response.data
            };
            
            console.log('✅ تم إرسال الرسالة التجريبية بنجاح');
            console.log('📊 استجابة الخادم:', JSON.stringify(response.data, null, 2));
            
            this.testResults.push(result);
            return result;
            
        } catch (error) {
            const result = {
                test: 'Send Test Message',
                success: false,
                error: error.message,
                status: error.response?.status,
                data: error.response?.data
            };
            
            console.log('❌ فشل في إرسال الرسالة التجريبية:', error.message);
            if (error.response?.data) {
                console.log('📊 تفاصيل الخطأ:', JSON.stringify(error.response.data, null, 2));
            }
            
            this.testResults.push(result);
            return result;
        }
    }
    
    // دالة لاختبار إعادة تشغيل البوت
    async testRestart() {
        console.log('🔍 اختبار إعادة تشغيل البوت...');
        
        try {
            const response = await axios.post(`${this.baseURL}/restart`, {}, {
                timeout: 5000
            });
            
            const result = {
                test: 'Bot Restart',
                success: true,
                status: response.status,
                data: response.data
            };
            
            console.log('✅ تم إعادة تشغيل البوت بنجاح');
            console.log('📊 استجابة الخادم:', JSON.stringify(response.data, null, 2));
            
            this.testResults.push(result);
            return result;
            
        } catch (error) {
            const result = {
                test: 'Bot Restart',
                success: false,
                error: error.message
            };
            
            console.log('❌ فشل في إعادة تشغيل البوت:', error.message);
            this.testResults.push(result);
            return result;
        }
    }
    
    // دالة لتشغيل جميع الاختبارات
    async runAllTests() {
        console.log('🚀 بدء تشغيل جميع الاختبارات...');
        console.log('=' .repeat(60));
        
        const tests = [
            () => this.testServerHealth(),
            () => this.testHomePage(),
            () => this.testPendingOrders(),
            () => this.testSendOrder(),
            () => this.testSendMessage()
        ];
        
        for (const test of tests) {
            try {
                await test();
                console.log('-' .repeat(40));
                
                // تأخير قصير بين الاختبارات
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                console.error('❌ خطأ في تشغيل الاختبار:', error);
            }
        }
        
        // إنشاء تقرير النتائج
        this.generateReport();
    }
    
    // دالة لإنشاء تقرير النتائج
    generateReport() {
        console.log('\n📊 تقرير نتائج الاختبار:');
        console.log('=' .repeat(60));
        
        const successful = this.testResults.filter(r => r.success).length;
        const failed = this.testResults.filter(r => !r.success).length;
        const total = this.testResults.length;
        
        console.log(`📈 إجمالي الاختبارات: ${total}`);
        console.log(`✅ نجح: ${successful}`);
        console.log(`❌ فشل: ${failed}`);
        console.log(`📊 معدل النجاح: ${((successful / total) * 100).toFixed(1)}%`);
        
        console.log('\n📋 تفاصيل النتائج:');
        this.testResults.forEach((result, index) => {
            const status = result.success ? '✅' : '❌';
            console.log(`${index + 1}. ${status} ${result.test}`);
            if (!result.success) {
                console.log(`   خطأ: ${result.error}`);
            }
        });
        
        // حفظ التقرير في ملف
        const report = {
            timestamp: new Date().toISOString(),
            summary: {
                total: total,
                successful: successful,
                failed: failed,
                successRate: ((successful / total) * 100).toFixed(1) + '%'
            },
            results: this.testResults
        };
        
        try {
            fs.writeFileSync('bot_test_report.json', JSON.stringify(report, null, 2));
            console.log('\n💾 تم حفظ التقرير في bot_test_report.json');
        } catch (error) {
            console.error('❌ خطأ في حفظ التقرير:', error);
        }
        
        console.log('=' .repeat(60));
        
        return report;
    }
    
    // دالة لاختبار الاتصال المستمر
    async testContinuousConnection(duration = 30000) {
        console.log(`🔍 اختبار الاتصال المستمر لمدة ${duration / 1000} ثانية...`);
        
        const startTime = Date.now();
        const results = [];
        let successCount = 0;
        let failCount = 0;
        
        while (Date.now() - startTime < duration) {
            try {
                const response = await axios.get(`${this.baseURL}/health`, {
                    timeout: 2000
                });
                
                successCount++;
                results.push({
                    timestamp: new Date().toISOString(),
                    success: true,
                    responseTime: response.headers['x-response-time'] || 'N/A'
                });
                
                process.stdout.write('✅');
                
            } catch (error) {
                failCount++;
                results.push({
                    timestamp: new Date().toISOString(),
                    success: false,
                    error: error.message
                });
                
                process.stdout.write('❌');
            }
            
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        console.log(`\n📊 نتائج الاختبار المستمر:`);
        console.log(`✅ نجح: ${successCount}`);
        console.log(`❌ فشل: ${failCount}`);
        console.log(`📈 معدل الاستقرار: ${((successCount / (successCount + failCount)) * 100).toFixed(1)}%`);
        
        return {
            duration: duration,
            successful: successCount,
            failed: failCount,
            stabilityRate: ((successCount / (successCount + failCount)) * 100).toFixed(1) + '%',
            results: results
        };
    }
}

// تشغيل الاختبار إذا تم استدعاء الملف مباشرة
if (require.main === module) {
    const tester = new WhatsAppBotTester();
    
    // التحقق من وجود معامل للاختبار المستمر
    const args = process.argv.slice(2);
    if (args.includes('--continuous')) {
        const duration = parseInt(args[args.indexOf('--continuous') + 1]) || 30000;
        tester.testContinuousConnection(duration).then(result => {
            console.log('\n🎉 انتهى الاختبار المستمر!');
        }).catch(error => {
            console.error('❌ خطأ في الاختبار المستمر:', error);
        });
    } else {
        tester.runAllTests().then(() => {
            console.log('\n🎉 انتهت جميع الاختبارات!');
        }).catch(error => {
            console.error('❌ خطأ في تشغيل الاختبارات:', error);
        });
    }
}

module.exports = WhatsAppBotTester;

