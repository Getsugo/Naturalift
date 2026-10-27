package fr.getsugo.naturalift

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.Period
import java.time.ZoneId

/**
 * Lecture des données de Samsung Health (et du Galaxy Fit3) via Health Connect :
 * sommeil de la nuit, pas des 15 derniers jours et séances du jour.
 * Lecture seule : l'appli n'écrit rien dans Health Connect.
 */
object HealthBridge {

    /** Réponse envoyée à l'appli web (JSON). */
    fun interface Callback {
        fun done(json: String)
    }

    private val PERMISSIONS = setOf(
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
    )

    private const val PROVIDER = "com.google.android.apps.healthdata"

    /** "unavailable", "update_required", "no_permission" ou "ok". */
    @JvmStatic
    fun status(ctx: Context): String {
        return when (HealthConnectClient.getSdkStatus(ctx, PROVIDER)) {
            HealthConnectClient.SDK_UNAVAILABLE -> "unavailable"
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "update_required"
            else -> try {
                val granted = runBlocking {
                    HealthConnectClient.getOrCreate(ctx).permissionController.getGrantedPermissions()
                }
                if (granted.containsAll(PERMISSIONS)) "ok" else "no_permission"
            } catch (e: Exception) {
                "unavailable"
            }
        }
    }

    /** Écran Health Connect qui demande les autorisations de lecture. */
    @JvmStatic
    fun permissionIntent(ctx: Context): Intent =
        PermissionController.createRequestPermissionResultContract(PROVIDER).createIntent(ctx, PERMISSIONS)

    /** Fiche Play Store de Health Connect (installation ou mise à jour). */
    @JvmStatic
    fun storeIntent(): Intent = Intent(
        Intent.ACTION_VIEW,
        Uri.parse("market://details?id=$PROVIDER&url=healthconnect%3A%2F%2Fonboarding")
    )

    /** Lit les données en arrière-plan puis appelle [callback] avec le résultat. */
    @JvmStatic
    fun sync(ctx: Context, callback: Callback) {
        val appCtx = ctx.applicationContext
        CoroutineScope(Dispatchers.IO).launch {
            val out = JSONObject()
            try {
                val client = HealthConnectClient.getOrCreate(appCtx)
                val zone = ZoneId.systemDefault()
                val today = LocalDate.now(zone)
                val now = Instant.now()

                // Pas par jour sur 15 jours (aujourd'hui compris).
                val steps = JSONObject()
                val groups = client.aggregateGroupByPeriod(
                    AggregateGroupByPeriodRequest(
                        metrics = setOf(StepsRecord.COUNT_TOTAL),
                        timeRangeFilter = TimeRangeFilter.between(
                            today.minusDays(14).atStartOfDay(),
                            LocalDateTime.now(zone)
                        ),
                        timeRangeSlicer = Period.ofDays(1)
                    )
                )
                for (g in groups) {
                    val count = g.result[StepsRecord.COUNT_TOTAL] ?: continue
                    steps.put(g.startTime.toLocalDate().toString(), count)
                }
                out.put("steps", steps)

                // Sommeil : nuits terminées aujourd'hui, sans les phases d'éveil.
                val sleep = client.readRecords(
                    ReadRecordsRequest(
                        recordType = SleepSessionRecord::class,
                        timeRangeFilter = TimeRangeFilter.between(now.minus(Duration.ofHours(20)), now)
                    )
                ).records
                var sleepMin = 0L
                for (s in sleep) {
                    if (s.endTime.atZone(zone).toLocalDate() != today) continue
                    var minutes = Duration.between(s.startTime, s.endTime).toMinutes()
                    for (stage in s.stages) {
                        if (stage.stage == SleepSessionRecord.STAGE_TYPE_AWAKE) {
                            minutes -= Duration.between(stage.startTime, stage.endTime).toMinutes()
                        }
                    }
                    sleepMin += maxOf(0L, minutes)
                }
                out.put("sleepMin", sleepMin)

                // Une séance enregistrée aujourd'hui (Samsung Health, appli de muscu…).
                val exercise = client.readRecords(
                    ReadRecordsRequest(
                        recordType = ExerciseSessionRecord::class,
                        timeRangeFilter = TimeRangeFilter.between(today.atStartOfDay(zone).toInstant(), now)
                    )
                ).records
                out.put("exerciseToday", exercise.isNotEmpty())
                out.put("ok", true)
            } catch (e: Exception) {
                out.put("ok", false)
                out.put("error", e.javaClass.simpleName)
            }
            callback.done(out.toString())
        }
    }
}
