package cc.ravenlove.roost

// 1119：同一次敲窗／来电可能从两条路到（页面的 ws、谷歌推送），只认先到的那次
object Dedup {
    private val seen = LinkedHashMap<String, Long>()
    @Synchronized
    fun first(kind: String, id: String): Boolean {
        val k = "$kind:$id"
        if (seen.containsKey(k)) return false
        seen[k] = System.currentTimeMillis()
        while (seen.size > 50) seen.remove(seen.keys.first())
        return true
    }
}
