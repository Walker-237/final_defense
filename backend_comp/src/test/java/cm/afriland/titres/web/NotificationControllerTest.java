package cm.afriland.titres.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.sql.ResultSet;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.MockedStatic;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import cm.afriland.titres.error.ApiException;
import cm.afriland.titres.security.AuthUser;
import cm.afriland.titres.support.PageResponse;
import cm.afriland.titres.support.Pagination;
import cm.afriland.titres.web.NotificationController.NotificationResponse;

/**
 * Tests for {@link NotificationController}.
 *
 * <h2>Assumptions made (source not available for these types)</h2>
 * <ul>
 * <li>{@link AuthUser}: exposes {@code id()} returning {@code UUID}.</li>
 * <li>{@link Pagination}: exposes static {@code of(Integer page, Integer size)} returning a
 *     {@code Pagination}, plus instance {@code limit()} (int), {@code offset()} (int), and
 *     {@code build(List<T>, long total)} returning a {@code PageResponse<T>}. Treated as an
 *     opaque collaborator since its source isn't available: tests stub its behaviour and assert
 *     the controller wires it correctly rather than asserting real pagination math.</li>
 * <li>{@link PageResponse}: opaque return type from {@code Pagination.build(...)}.</li>
 * </ul>
 *
 * <p>Note: generics-heavy stubs ({@code Pagination.build}, {@code queryForObject}) use
 * {@code doReturn(...).when(...)} instead of {@code when(...).thenReturn(...)} — the latter
 * fails to compile here because javac can't always infer the right type parameter from bare
 * {@code any()} / {@code List.of()} arguments, and {@code doReturn} sidesteps that entirely.</p>
 */
@SuppressWarnings({"unchecked", "rawtypes"})
class NotificationControllerTest {

    private JdbcTemplate jdbc;
    private NotificationController controller;
    private AuthUser user;
    private UUID userId;

    @BeforeEach
    void setUp() {
        jdbc = mock(JdbcTemplate.class);
        controller = new NotificationController(jdbc);
        userId = UUID.randomUUID();
        user = mock(AuthUser.class);
        when(user.id()).thenReturn(userId);
    }

    @Nested
    class List_ {

        @Test
        void list_buildsPagination_queriesRows_andReturnsPageResponse() {
            Pagination pg = mock(Pagination.class);
            when(pg.limit()).thenReturn(20L);
            when(pg.offset()).thenReturn(0L);

            List<NotificationResponse> rows = List.of();
            Long total = 5L;
            when(jdbc.query(anyString(), any(RowMapper.class), eq(userId), eq(20L), eq(0L)))
                    .thenReturn(rows);
            doReturn(total).when(jdbc).queryForObject(anyString(), eq(Long.class), eq(userId));

            PageResponse<NotificationResponse> expected = mock(PageResponse.class);
            doReturn(expected).when(pg).build(rows, 5L);

            try (MockedStatic<Pagination> pagination = mockStatic(Pagination.class)) {
                pagination.when(() -> Pagination.of(2, 20)).thenReturn(pg);

                PageResponse<NotificationResponse> result = controller.list(user, 2, 20);

                assertThat(result).isSameAs(expected);
                pagination.verify(() -> Pagination.of(2, 20));
            }
            verify(jdbc).query(anyString(), any(RowMapper.class), eq(userId), eq(20L), eq(0L));
            verify(jdbc).queryForObject(anyString(), eq(Long.class), eq(userId));
        }

        @Test
        void list_withNullPageAndSize_stillDelegatesToPaginationOf() {
            Pagination pg = mock(Pagination.class);
            when(pg.limit()).thenReturn(10L);
            when(pg.offset()).thenReturn(0L);

            List<NotificationResponse> rows = List.of();
            Long total = 0L;
            when(jdbc.query(anyString(), any(RowMapper.class), eq(userId), eq(10), eq(0)))
                    .thenReturn(rows);
            doReturn(total).when(jdbc).queryForObject(anyString(), eq(Long.class), eq(userId));

            PageResponse<NotificationResponse> expected = mock(PageResponse.class);
            doReturn(expected).when(pg).build(rows, 0L);

            try (MockedStatic<Pagination> pagination = mockStatic(Pagination.class)) {
                pagination.when(() -> Pagination.of(null, null)).thenReturn(pg);

                PageResponse<NotificationResponse> result = controller.list(user, null, null);

                assertThat(result).isSameAs(expected);
            }
        }
    }

    @Nested
    class UnreadCount {

        @Test
        void unreadCount_returnsCountFromQuery() {
            Long count = 7L;
            doReturn(count).when(jdbc).queryForObject(anyString(), eq(Long.class), eq(userId));

            Map<String, Object> result = controller.unreadCount(user);

            assertThat(result).containsEntry("count", 7L);
        }
    }

    @Nested
    class MarkRead {

        @Test
        void affectedRowFound_returnsSuccessMessage() {
            UUID notifId = UUID.randomUUID();
            when(jdbc.update(anyString(), eq(notifId), eq(userId))).thenReturn(1);

            Map<String, Object> result = controller.markRead(user, notifId);

            assertThat(result).containsEntry("message", "Notification marquée comme lue.");
        }

        @Test
        void noRowAffected_throwsNotFound() {
            UUID notifId = UUID.randomUUID();
            when(jdbc.update(anyString(), eq(notifId), eq(userId))).thenReturn(0);

            assertThatThrownBy(() -> controller.markRead(user, notifId))
                    .isInstanceOf(ApiException.class)
                    .hasMessage("Notification introuvable.");
        }
    }

    @Nested
    class MarkAllRead {

        @Test
        void marksAllUnreadNotifications_forCurrentUser() {
            when(jdbc.update(anyString(), eq(userId))).thenReturn(3);

            Map<String, Object> result = controller.markAllRead(user);

            assertThat(result).containsEntry("message", "Toutes les notifications sont marquées comme lues.");
            verify(jdbc).update(anyString(), eq(userId));
        }
    }

    @Nested
    class Mapper {

        @Test
        void rowMapper_mapsAllColumnsOntoNotificationResponse() throws Exception {
            ArgumentCaptor<RowMapper> captor = ArgumentCaptor.forClass(RowMapper.class);
            List<NotificationResponse> emptyRows = List.of();
            when(jdbc.query(anyString(), captor.capture(), any(), any(), any())).thenReturn(emptyRows);
            Long total = 0L;
            doReturn(total).when(jdbc).queryForObject(anyString(), eq(Long.class), any());

            Pagination pg = mock(Pagination.class);
            when(pg.limit()).thenReturn(20L);
            when(pg.offset()).thenReturn(0L);
            PageResponse<NotificationResponse> expected = mock(PageResponse.class);
            doReturn(expected).when(pg).build(emptyRows, 0L);

            try (MockedStatic<Pagination> pagination = mockStatic(Pagination.class)) {
                pagination.when(() -> Pagination.of(any(), any())).thenReturn(pg);
                controller.list(user, null, null);
            }

            RowMapper<NotificationResponse> mapper = captor.getValue();
            ResultSet rs = mock(ResultSet.class);
            UUID notifId = UUID.randomUUID();
            OffsetDateTime createdAt = OffsetDateTime.now();
            when(rs.getObject("id", UUID.class)).thenReturn(notifId);
            when(rs.getString("type")).thenReturn("WARN");
            when(rs.getString("titre")).thenReturn("Opération rejetée");
            when(rs.getString("message")).thenReturn("Un message");
            when(rs.getString("reference")).thenReturn("ORD-42");
            when(rs.getBoolean("lu")).thenReturn(true);
            when(rs.getObject("created_at", OffsetDateTime.class)).thenReturn(createdAt);

            NotificationResponse mapped = mapper.mapRow(rs, 1);

            assertThat(mapped.id()).isEqualTo(notifId);
            assertThat(mapped.type()).isEqualTo("WARN");
            assertThat(mapped.titre()).isEqualTo("Opération rejetée");
            assertThat(mapped.message()).isEqualTo("Un message");
            assertThat(mapped.reference()).isEqualTo("ORD-42");
            assertThat(mapped.lu()).isTrue();
            assertThat(mapped.createdAt()).isEqualTo(createdAt);
        }
    }
}