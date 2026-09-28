package ru.yami.tkpst.data

import kotlinx.serialization.Serializable

/** Ответы OpenScheduleApi (https://github.com/ThisIsHyum/OpenScheduleApi). */

@Serializable
data class ApiReplace(
    val title: String? = null,
    val cabinet: String? = null,
    val teacher: String? = null,
)

@Serializable
data class ApiLesson(
    val title: String = "",
    val cabinet: String? = null,
    val teacher: String? = null,
    val order: Int = 0,
    val startTime: String? = null,
    val endTime: String? = null,
    val replace: ApiReplace? = null,
)

@Serializable
data class ApiDay(
    val groupId: Int = 0,
    val date: String = "",
    val lessons: List<ApiLesson> = emptyList(),
)

@Serializable
data class ApiGroup(
    val studentGroupId: Int,
    val name: String,
    val campusId: Int = 0,
)

@Serializable
data class ApiDate(val date: String = "")
