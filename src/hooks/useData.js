import { useState, useEffect } from "react";
import { healthCheck, getStatistics, getTotalCount } from "../services/api";

const normalizeMetrics = (statsData, countData, featureImportances = []) => {
    // Helper para extrair valores numéricos de chaves variadas
    const getVal = (obj, keys, defaultValue = 0) => {
        if (!obj) return defaultValue;
        for (const key of keys) {
            if (obj[key] !== undefined && obj[key] !== null) {
                return Number(obj[key]);
            }
        }
        return defaultValue;
    };

    // 1. Total de Clientes
    let total = getVal(countData, ['total', 'count', 'totalClients']) ||
        getVal(statsData, ['totalClients', 'totalCustomers', 'total']);

    // 2. Taxa de Churn Global
    let churnRate = getVal(statsData, ['averageChurnProbability', 'globalChurnRate', 'churnRate', 'churn_rate']);
    // Normalização: se vier 0.25 vira 25.0
    if (churnRate <= 1 && churnRate > 0) churnRate = churnRate * 100;

    // 3. Contagens de Churn/Stay (CORREÇÃO CRÍTICA AQUI)
    let churnCount = getVal(statsData, ['clientsWillChurn', 'churnCount', 'highRiskCount', 'churn_count']);

    // SE a contagem vier zerada, mas temos Total e Taxa, CALCULAMOS matematicamente.
    if (churnCount === 0 && total > 0 && churnRate > 0) {
        churnCount = Math.round(total * (churnRate / 100));
    }

    let stayCount = getVal(statsData, ['clientsWillStay', 'stayCount', 'stay_count']);
    if (stayCount === 0 && total > 0) {
        stayCount = total - churnCount;
    }

    // 4. Distribuição para o Gráfico
    let distArray = statsData?.churnDistribution || statsData?.churn_distribution;
    if (!distArray || (distArray[0] === 0 && distArray[1] === 0)) {
        // Se a API não mandou o array pronto, montamos com os valores calculados acima
        distArray = [stayCount, churnCount];
    }

    // 5. Receita (Estimada)
    let revenueRisk = getVal(statsData, ['revenueAtRisk', 'revenue_at_risk']);
    // Se API não mandou, estima: Churn Count * $12.90
    if (revenueRisk === 0 && churnCount > 0) {
        revenueRisk = churnCount * 12.90;
    }

    // 6. Acurácia
    let accuracy = getVal(statsData, ['modelAccuracy', 'auc', 'accuracy']);
    if (accuracy <= 1 && accuracy > 0) accuracy = accuracy * 100;

    // 7. Feature Importance
    const apiFeatures = statsData?.featureImportance || statsData?.feature_importance;
    const finalFeatures = Array.isArray(apiFeatures) && apiFeatures.length > 0
        ? apiFeatures
        : (featureImportances || []);

    return {
        totalClients: total,
        globalChurnRate: churnRate.toFixed(1),
        highRiskCount: churnCount,
        revenueAtRisk: revenueRisk,
        modelAccuracy: accuracy.toFixed(1),
        churnDistribution: distArray,
        featureImportance: finalFeatures
    };
};

export function useData() {
    const [metrics, setMetrics] = useState(null);
    const [apiStatus, setApiStatus] = useState('checking');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchData = async () => {
        setLoading(true);
        setError(null);

        try {
            // 1. Check Health (fail-safe)
            try {
                const health = await healthCheck();
                setApiStatus(health.status === 'UP' ? 'online' : 'degraded');
            } catch { setApiStatus('offline'); }

            // 2. Busca Dados em Paralelo
            const [statsRes, countRes, staticRes] = await Promise.allSettled([
                getStatistics(),
                getTotalCount(),
                fetch("./metrics.json").then(r => r.json()).catch(() => ({})) // Fallback de estrutura
            ]);

            const statsData = statsRes.status === 'fulfilled' ? statsRes.value : {};
            const countData = countRes.status === 'fulfilled' ? countRes.value : {};
            const staticData = staticRes.status === 'fulfilled' ? staticRes.value : {};

            console.log("📊 RAW Stats API:", statsData);

            // Normaliza
            const normalized = normalizeMetrics(
                { ...staticData, ...statsData },
                countData,
                staticData.featureImportance
            );

            console.log("✅ Métricas Calculadas:", normalized);
            setMetrics(normalized);

        } catch (err) {
            console.error("❌ Erro useData:", err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    return { metrics, apiStatus, loading, error, refresh: fetchData };
}