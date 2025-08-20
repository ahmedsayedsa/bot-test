// سكريبت اختبار واكتشاف Easy Order API
const EasyOrderAPI = require('./easyorder-api');
const axios = require('axios');

class EasyOrderTester {
    constructor() {
        this.api = new EasyOrderAPI();
        this.discoveredEndpoints = [];
    }
    
    // دالة لاختبار الاتصال الأساسي
    async testBasicConnection() {
        console.log('🔍 اختبار الاتصال الأساسي...');
        
        const result = await this.api.testConnection();
        
        if (result.success) {
            console.log('✅ الاتصال ناجح!');
            console.log('📊 تفاصيل الاستجابة:', JSON.stringify(result.data, null, 2));
        } else {
            console.log('❌ فشل الاتصال');
        }
        
        return result;
    }
    
    // دالة لاكتشاف هيكل API
    async discoverAPI() {
        console.log('🔍 اكتشاف هيكل API...');
        
        const results = await this.api.discoverAPIStructure();
        
        if (results.length > 0) {
            console.log(`✅ تم العثور على ${results.length} وثيقة API`);
            results.forEach((result, index) => {
                console.log(`📄 وثيقة ${index + 1}: ${result.endpoint}`);
            });
        } else {
            console.log('❌ لم يتم العثور على وثائق API');
        }
        
        return results;
    }
    
    // دالة لاختبار endpoints مختلفة
    async testCommonEndpoints() {
        console.log('🔍 اختبار endpoints شائعة...');
        
        const commonEndpoints = [
            '/orders',
            '/api/orders',
            '/v1/orders',
            '/order',
            '/products',
            '/customers',
            '/webhooks',
            '/status',
            '/health'
        ];
        
        const results = [];
        
        for (const endpoint of commonEndpoints) {
            try {
                const url = this.api.baseURL + endpoint;
                console.log(`🔍 اختبار ${url}...`);
                
                const response = await axios.get(url, {
                    headers: {
                        'Authorization': `Bearer ${this.api.apiKey}`,
                        'X-API-Key': this.api.apiKey,
                        'Content-Type': 'application/json'
                    },
                    timeout: 5000
                });
                
                results.push({
                    endpoint: endpoint,
                    url: url,
                    status: response.status,
                    success: true,
                    headers: response.headers,
                    dataType: typeof response.data,
                    dataSize: JSON.stringify(response.data).length
                });
                
                console.log(`✅ ${endpoint}: ${response.status}`);
                
            } catch (error) {
                results.push({
                    endpoint: endpoint,
                    url: this.api.baseURL + endpoint,
                    success: false,
                    error: error.message,
                    status: error.response?.status
                });
                
                console.log(`❌ ${endpoint}: ${error.message}`);
            }
            
            // تأخير قصير بين الطلبات
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        return results;
    }
    
    // دالة لاختبار تحديث حالة طلب وهمي
    async testOrderStatusUpdate() {
        console.log('🔍 اختبار تحديث حالة طلب وهمي...');
        
        const testOrderData = {
            orderId: 'TEST_' + Date.now(),
            customerName: 'عميل تجريبي',
            customerPhone: '201234567890',
            total: 100,
            address: 'عنوان تجريبي'
        };
        
        console.log('📝 بيانات الطلب التجريبي:', testOrderData);
        
        // اختبار تأكيد الطلب
        const confirmResult = await this.api.updateOrderStatus(
            testOrderData.orderId,
            'confirmed',
            testOrderData
        );
        
        console.log('📊 نتيجة تأكيد الطلب:', confirmResult);
        
        // تأخير قصير
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // اختبار إلغاء الطلب
        const cancelResult = await this.api.updateOrderStatus(
            testOrderData.orderId,
            'cancelled',
            testOrderData
        );
        
        console.log('📊 نتيجة إلغاء الطلب:', cancelResult);
        
        return {
            confirm: confirmResult,
            cancel: cancelResult
        };
    }
    
    // دالة لتحليل استجابات الخطأ
    async analyzeErrorResponses() {
        console.log('🔍 تحليل استجابات الخطأ...');
        
        const testCases = [
            { method: 'GET', endpoint: '/nonexistent' },
            { method: 'POST', endpoint: '/orders/invalid' },
            { method: 'PUT', endpoint: '/orders/123/status' },
            { method: 'DELETE', endpoint: '/orders/123' }
        ];
        
        const errorAnalysis = [];
        
        for (const testCase of testCases) {
            try {
                const url = this.api.baseURL + testCase.endpoint;
                
                let response;
                if (testCase.method === 'GET') {
                    response = await axios.get(url, {
                        headers: {
                            'Authorization': `Bearer ${this.api.apiKey}`,
                            'X-API-Key': this.api.apiKey
                        },
                        timeout: 5000
                    });
                } else if (testCase.method === 'POST') {
                    response = await axios.post(url, { test: true }, {
                        headers: {
                            'Authorization': `Bearer ${this.api.apiKey}`,
                            'X-API-Key': this.api.apiKey,
                            'Content-Type': 'application/json'
                        },
                        timeout: 5000
                    });
                }
                
                errorAnalysis.push({
                    ...testCase,
                    status: response.status,
                    success: true,
                    data: response.data
                });
                
            } catch (error) {
                errorAnalysis.push({
                    ...testCase,
                    status: error.response?.status,
                    success: false,
                    error: error.message,
                    errorData: error.response?.data
                });
                
                console.log(`📊 ${testCase.method} ${testCase.endpoint}: ${error.response?.status} - ${error.message}`);
            }
            
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        return errorAnalysis;
    }
    
    // دالة لإنشاء تقرير شامل
    async generateReport() {
        console.log('📋 إنشاء تقرير شامل...');
        
        const report = {
            timestamp: new Date().toISOString(),
            apiConfig: {
                baseURL: this.api.baseURL,
                hasApiKey: !!this.api.apiKey,
                hasBackupURL: !!this.api.backupURL
            },
            tests: {}
        };
        
        try {
            // اختبار الاتصال الأساسي
            report.tests.basicConnection = await this.testBasicConnection();
            
            // اكتشاف API
            report.tests.apiDiscovery = await this.discoverAPI();
            
            // اختبار endpoints شائعة
            report.tests.commonEndpoints = await this.testCommonEndpoints();
            
            // اختبار تحديث حالة الطلب
            report.tests.orderStatusUpdate = await this.testOrderStatusUpdate();
            
            // تحليل استجابات الخطأ
            report.tests.errorAnalysis = await this.analyzeErrorResponses();
            
            // إحصائيات API
            report.stats = this.api.getStats();
            
        } catch (error) {
            report.error = error.message;
            console.error('❌ خطأ في إنشاء التقرير:', error);
        }
        
        // حفظ التقرير
        try {
            const fs = require('fs');
            fs.writeFileSync('easyorder_test_report.json', JSON.stringify(report, null, 2));
            console.log('💾 تم حفظ التقرير في easyorder_test_report.json');
        } catch (saveError) {
            console.error('❌ خطأ في حفظ التقرير:', saveError);
        }
        
        return report;
    }
    
    // دالة لطباعة ملخص النتائج
    printSummary(report) {
        console.log('\n📊 ملخص نتائج الاختبار:');
        console.log('=' .repeat(50));
        
        if (report.tests.basicConnection?.success) {
            console.log('✅ الاتصال الأساسي: ناجح');
        } else {
            console.log('❌ الاتصال الأساسي: فاشل');
        }
        
        const workingEndpoints = report.tests.commonEndpoints?.filter(e => e.success).length || 0;
        const totalEndpoints = report.tests.commonEndpoints?.length || 0;
        console.log(`📡 Endpoints العاملة: ${workingEndpoints}/${totalEndpoints}`);
        
        if (report.tests.orderStatusUpdate) {
            const confirmSuccess = report.tests.orderStatusUpdate.confirm?.success;
            const cancelSuccess = report.tests.orderStatusUpdate.cancel?.success;
            console.log(`📝 تحديث حالة الطلب: تأكيد ${confirmSuccess ? '✅' : '❌'}, إلغاء ${cancelSuccess ? '✅' : '❌'}`);
        }
        
        console.log(`📈 إحصائيات: ${report.stats?.successful || 0} ناجح، ${report.stats?.failed || 0} فاشل`);
        console.log('=' .repeat(50));
    }
}

// تشغيل الاختبار إذا تم استدعاء الملف مباشرة
if (require.main === module) {
    const tester = new EasyOrderTester();
    
    tester.generateReport().then(report => {
        tester.printSummary(report);
        console.log('\n🎉 انتهى الاختبار! راجع ملف easyorder_test_report.json للتفاصيل الكاملة.');
    }).catch(error => {
        console.error('❌ خطأ في تشغيل الاختبار:', error);
    });
}

module.exports = EasyOrderTester;

