package cm.afriland.titres.web;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import cm.afriland.titres.audit.AuditService;
import cm.afriland.titres.error.ApiException;
import cm.afriland.titres.security.AuthUser;
import cm.afriland.titres.security.ClientIp;
import cm.afriland.titres.security.Permission;
import cm.afriland.titres.support.PageResponse;
import cm.afriland.titres.web.DocumentController.CreateDocumentRequest;
import cm.afriland.titres.web.DocumentController.DocumentResponse;
import java.sql.ResultSet;
import java.sql.SQLException;

/**
 * Tests for {@link DocumentController}.
 *
 * <h2>Assumptions made (source not available for these types)</h2>
 * <ul>
 * <li>{@link AuthUser}: mockable, exposes {@code id()}, {@code isClient()},
 * {@code require(Permission)} (void, throws {@link ApiException} on failure).</li>
 * <li>{@link ClientIp}: mockable, exposes {@code value()} returning a {@code String}.</li>
 * <li>{@link AuditService}: exposes a public static {@code SUCCES} constant and a
 * {@code log(String userId, String action, String result, String reference, String ip)} method.</li>
 * <li>{@code Permission.DOCUMENT_UPLOAD} exists as an enum constant.</li>
 * <li>{@code Pagination.of(Integer, Integer)} and {@code PageResponse} are real,
 * lightweight value classes left un-mocked (not worth stubbing); only their
 * presence/non-nullness is asserted here since their internal accessor names
 * weren't available. Tighten with real field/record-component assertions once
 * you paste those classes.</li>
 * </ul>
 *
 * <p>Because {@link JdbcTemplate} is a Mockito mock, the {@link RowMapper} lambdas built
 * inside the controller are never actually invoked — Mockito just returns whatever list
 * we stub. This means these tests don't need to fake a {@code ResultSet}; they only need
 * to stub {@code jdbc.query}/{@code queryForObject}/{@code update} with the right SQL
 * fragment + argument matchers and assert on the controller's resulting behavior.</p>
 */
@SuppressWarnings("unchecked")
class DocumentControllerTest {
    private JdbcTemplate jdbc;
    private AuditService audit;
    private DocumentController controller;

    @BeforeEach
    void setUp() {
        jdbc = mock(JdbcTemplate.class);
        audit = mock(AuditService.class);
        controller = new DocumentController(jdbc, audit);
    }

    private AuthUser staffUser(UUID id) {
        AuthUser user = mock(AuthUser.class);
        when(user.id()).thenReturn(id);
        when(user.isClient()).thenReturn(false);
        return user;
    }

    private AuthUser clientUser(UUID id) {
        AuthUser user = mock(AuthUser.class);
        when(user.id()).thenReturn(id);
        when(user.isClient()).thenReturn(true);
        return user;
    }

    private DocumentResponse doc(UUID id, UUID clientId, String contenu) {
        return new DocumentResponse(id, "DOC-20260709-000001", "ATTESTATION", "Titre", clientId, "Nom Prenom", UUID.randomUUID(), "application/pdf", "12KB", 0, OffsetDateTime.now(ZoneOffset.UTC), contenu);
    }

    private CreateDocumentRequest uploadRequest(UUID clientId, String mimeType, String contenu) {
        return new CreateDocumentRequest(clientId, "ATTESTATION", "Titre du document", mimeType, "12KB", contenu);
    }

    @Nested
    class List_ {
        @Test
        void clientScope_filtersByClientIdOnBothQueries() {
            UUID clientId = UUID.randomUUID();
            AuthUser user = clientUser(clientId);
            List<DocumentResponse> rows = List.of(doc(UUID.randomUUID(), clientId, null));
            when(jdbc.query(contains("WHERE d.client_id = ?"), any(RowMapper.class), eq(clientId), anyLong(), anyLong())).thenReturn(rows);
            when(jdbc.queryForObject(contains("WHERE client_id = ?"), eq(Long.class), eq(clientId)))
                    .thenReturn(1L);
            PageResponse<DocumentResponse> result = controller.list(user, 0, 20);
            assertThat(result).isNotNull();
            verify(jdbc).query(contains("WHERE d.client_id = ?"), any(RowMapper.class), eq(clientId), anyLong(), anyLong());
            verify(jdbc).queryForObject(contains("WHERE client_id = ?"), eq(Long.class), eq(clientId));
            // Staff-scope (unfiltered) query variants must never fire for a client.
            verify(jdbc, never()).queryForObject(eq("SELECT count(*) FROM documents"), eq(Long.class));
        }

        @Test
        void staffScope_seesAllDocuments_unfiltered() {
            AuthUser user = staffUser(UUID.randomUUID());
            List<DocumentResponse> rows = List.of(
                    doc(UUID.randomUUID(), UUID.randomUUID(), null),
                    doc(UUID.randomUUID(), UUID.randomUUID(), null));
            when(jdbc.query(contains("ORDER BY d.date_generation DESC LIMIT ? OFFSET ?"), any(RowMapper.class), anyLong(), anyLong())).thenReturn(rows);
            when(jdbc.queryForObject(eq("SELECT count(*) FROM documents"), eq(Long.class)))
                    .thenReturn(2L);
            PageResponse<DocumentResponse> result = controller.list(user, 0, 20);
            assertThat(result).isNotNull();
            verify(jdbc).queryForObject(eq("SELECT count(*) FROM documents"), eq(Long.class));
            verify(jdbc, never()).queryForObject(contains("WHERE client_id = ?"), eq(Long.class), any(UUID.class));
        }
    }

    @Nested
    class Get {
        @Test
        void unknownId_throwsNotFound() {
            UUID id = UUID.randomUUID();
            AuthUser user = staffUser(UUID.randomUUID());
            when(jdbc.query(contains("FROM documents d JOIN users u"), any(RowMapper.class), eq(id)))
                    .thenReturn(List.of());
            assertThatThrownBy(() -> controller.get(user, id)).isInstanceOf(ApiException.class);
            verify(jdbc, never()).queryForObject(contains("SELECT contenu"), eq(String.class), any(UUID.class));
            verify(jdbc, never()).update(anyString(), any(UUID.class));
        }

        @Test
        void clientRequestingAnotherClientsDocument_throwsNotFound_andNeverFetchesContent() {
            UUID id = UUID.randomUUID();
            UUID ownerId = UUID.randomUUID();
            UUID requesterId = UUID.randomUUID();
            AuthUser user = clientUser(requesterId);
            when(jdbc.query(contains("FROM documents d JOIN users u"), any(RowMapper.class), eq(id)))
                    .thenReturn(List.of(doc(id, ownerId, null)));
            assertThatThrownBy(() -> controller.get(user, id)).isInstanceOf(ApiException.class);
            verify(jdbc, never()).queryForObject(contains("SELECT contenu"), eq(String.class), eq(id));
            verify(jdbc, never()).update(anyString(), eq(id));
        }

        @Test
        void staffPreview_fetchesContentButDoesNotIncrementDownloadCounter() {
            UUID id = UUID.randomUUID();
            UUID clientId = UUID.randomUUID();
            AuthUser staff = staffUser(UUID.randomUUID());
            when(jdbc.query(contains("FROM documents d JOIN users u"), any(RowMapper.class), eq(id)))
                    .thenReturn(List.of(doc(id, clientId, null)), List.of(doc(id, clientId, "QkFTRTY0")));
            when(jdbc.queryForObject(contains("SELECT contenu"), eq(String.class), eq(id)))
                    .thenReturn("QkFTRTY0");
            DocumentResponse result = controller.get(staff, id);
            assertThat(result.contenu()).isEqualTo("QkFTRTY0");
            verify(jdbc, never()).update(anyString(), eq(id));
        }

        @Test
        void ownerClient_fetchesContentAndIncrementsDownloadCounter() {
            UUID id = UUID.randomUUID();
            UUID clientId = UUID.randomUUID();
            AuthUser owner = clientUser(clientId);
            when(jdbc.query(contains("FROM documents d JOIN users u"), any(RowMapper.class), eq(id)))
                    .thenReturn(List.of(doc(id, clientId, null)), List.of(doc(id, clientId, "QkFTRTY0")));
            when(jdbc.queryForObject(contains("SELECT contenu"), eq(String.class), eq(id)))
                    .thenReturn("QkFTRTY0");
            DocumentResponse result = controller.get(owner, id);
            assertThat(result.contenu()).isEqualTo("QkFTRTY0");
            verify(jdbc).update(contains("telechargements = telechargements + 1"), eq(id));
        }
    }

    @Nested
    class Upload {
        private final ClientIp ip = mock(ClientIp.class);

        @BeforeEach
        void stubIp() {
            when(ip.value()).thenReturn("127.0.0.1");
        }

        @Test
        void missingPermission_throwsAndNeverTouchesDbOrAudit() {
            AuthUser user = staffUser(UUID.randomUUID());
            doThrow(ApiException.badRequest("no permission")).when(user).require(Permission.DOCUMENT_UPLOAD);
            assertThatThrownBy(() -> controller.upload(user, ip, uploadRequest(UUID.randomUUID(), "application/pdf", null)))
                    .isInstanceOf(ApiException.class);
            verifyNoInteractions(jdbc);
            verifyNoInteractions(audit);
        }

        @Test
        void dataUriWithNoDeclaredType_skipsConsistencyCheck() {
            UUID uploaderId = UUID.randomUUID();
            UUID clientId = UUID.randomUUID();
            UUID newId = UUID.randomUUID();
            AuthUser user = staffUser(uploaderId);
            String contenu = "data:;base64,QUJD";

            when(jdbc.query(contains("SELECT role FROM users WHERE id = ?"), any(RowMapper.class), eq(clientId)))
                    .thenReturn(List.of("CLIENT_PP"));
            when(jdbc.queryForObject(eq("SELECT count(*) FROM documents"), eq(Long.class))).thenReturn(0L);
            when(jdbc.queryForObject(contains("INSERT INTO documents"), eq(UUID.class),
                    anyString(), eq("ATTESTATION"), eq("Titre du document"), eq(clientId),
                    eq(uploaderId), eq("application/pdf"), eq("12KB"), eq(contenu)))
                    .thenReturn(newId);
            when(jdbc.query(contains("FROM documents d JOIN users u"), any(RowMapper.class), eq(newId)))
                    .thenReturn(List.of(doc(newId, clientId, null)));

            ResponseEntity<DocumentResponse> response = controller.upload(user, ip,
                    uploadRequest(clientId, "application/pdf", contenu));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        }

        @Test
        void unknownDestinataire_throwsNotFound() {
            AuthUser user = staffUser(UUID.randomUUID());
            UUID clientId = UUID.randomUUID();
            when(jdbc.query(contains("SELECT role FROM users WHERE id = ?"), any(RowMapper.class), eq(clientId)))
                    .thenReturn(List.of());
            assertThatThrownBy(() -> controller.upload(user, ip, uploadRequest(clientId, "application/pdf", null)))
                    .isInstanceOf(ApiException.class);
            verifyNoInteractions(audit);
        }

        @Test
        void destinataireNotAClient_throwsBadRequest() {
            AuthUser user = staffUser(UUID.randomUUID());
            UUID staffId = UUID.randomUUID();
            when(jdbc.query(contains("SELECT role FROM users WHERE id = ?"), any(RowMapper.class), eq(staffId)))
                    .thenReturn(List.of("AGENT"));
            assertThatThrownBy(() -> controller.upload(user, ip, uploadRequest(staffId, "application/pdf", null)))
                    .isInstanceOf(ApiException.class);
            verifyNoInteractions(audit);
        }

        @Test
        void disallowedMimeType_throwsBadRequest() {
            AuthUser user = staffUser(UUID.randomUUID());
            UUID clientId = UUID.randomUUID();
            when(jdbc.query(contains("SELECT role FROM users WHERE id = ?"), any(RowMapper.class), eq(clientId)))
                    .thenReturn(List.of("CLIENT_PP"));
            assertThatThrownBy(() -> controller.upload(user, ip, uploadRequest(clientId, "text/html", null)))
                    .isInstanceOf(ApiException.class);
            verifyNoInteractions(audit);
        }

        @Test
        void dataUriDeclaredTypeMismatchesResolvedMime_throwsBadRequest() {
            AuthUser user = staffUser(UUID.randomUUID());
            UUID clientId = UUID.randomUUID();
            when(jdbc.query(contains("SELECT role FROM users WHERE id = ?"), any(RowMapper.class), eq(clientId)))
                    .thenReturn(List.of("CLIENT_PM"));
            assertThatThrownBy(() -> controller.upload(user, ip, uploadRequest(clientId, "application/pdf", "data:image/png;base64,QUJD")))
                    .isInstanceOf(ApiException.class);
            verifyNoInteractions(audit);
        }

        @Test
        void successfulUpload_createsDocument_andAudits() {
            UUID uploaderId = UUID.randomUUID();
            UUID clientId = UUID.randomUUID();
            UUID newId = UUID.randomUUID();
            AuthUser user = staffUser(uploaderId);
            when(jdbc.query(contains("SELECT role FROM users WHERE id = ?"), any(RowMapper.class), eq(clientId)))
                    .thenReturn(List.of("CLIENT_PP"));
            when(jdbc.queryForObject(eq("SELECT count(*) FROM documents"), eq(Long.class)))
                    .thenReturn(0L);
            when(jdbc.queryForObject(contains("INSERT INTO documents"), eq(UUID.class), anyString(), eq("ATTESTATION"), eq("Titre du document"), eq(clientId), eq(uploaderId), eq("application/pdf"), eq("12KB"), isNull()))
                    .thenReturn(newId);
            when(jdbc.query(contains("FROM documents d JOIN users u"), any(RowMapper.class), eq(newId)))
                    .thenReturn(List.of(doc(newId, clientId, null)));
            ResponseEntity<DocumentResponse> response = controller.upload(user, ip, uploadRequest(clientId, "application/pdf", null));
            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
            assertThat(response.getBody()).isNotNull();
            assertThat(response.getBody().id()).isEqualTo(newId);
            ArgumentCaptor<String> referenceCaptor = ArgumentCaptor.forClass(String.class);
            verify(audit).log(eq(uploaderId.toString()), eq("DEPOT_LIVRABLE"), eq(AuditService.SUCCES), referenceCaptor.capture(), eq("127.0.0.1"));
            assertThat(referenceCaptor.getValue()).startsWith("DOC-");
        }

        @Test
        void referenceCollision_retriesThenSucceeds() {
            UUID uploaderId = UUID.randomUUID();
            UUID clientId = UUID.randomUUID();
            UUID newId = UUID.randomUUID();
            AuthUser user = staffUser(uploaderId);
            String today = OffsetDateTime.now(ZoneOffset.UTC).format(DateTimeFormatter.ofPattern("yyyyMMdd"));
            String expectedReference = "DOC-" + today + "-000001";
            when(jdbc.query(contains("SELECT role FROM users WHERE id = ?"), any(RowMapper.class), eq(clientId)))
                    .thenReturn(List.of("CLIENT_PP"));
            when(jdbc.queryForObject(eq("SELECT count(*) FROM documents"), eq(Long.class)))
                    .thenReturn(0L);
            when(jdbc.queryForObject(contains("INSERT INTO documents"), eq(UUID.class), eq(expectedReference), eq("ATTESTATION"), eq("Titre du document"), eq(clientId), eq(uploaderId), eq("application/pdf"), eq("12KB"), isNull()))
                    .thenThrow(new DataIntegrityViolationException("duplicate reference"))
                    .thenThrow(new DataIntegrityViolationException("duplicate reference"))
                    .thenReturn(newId);
            when(jdbc.query(contains("FROM documents d JOIN users u"), any(RowMapper.class), eq(newId)))
                    .thenReturn(List.of(doc(newId, clientId, null)));
            ResponseEntity<DocumentResponse> response = controller.upload(user, ip, uploadRequest(clientId, "application/pdf", null));
            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
            verify(jdbc, times(3)).queryForObject(contains("INSERT INTO documents"), eq(UUID.class), eq(expectedReference), eq("ATTESTATION"), eq("Titre du document"), eq(clientId), eq(uploaderId), eq("application/pdf"), eq("12KB"), isNull());
            verify(audit).log(eq(uploaderId.toString()), eq("DEPOT_LIVRABLE"), eq(AuditService.SUCCES), eq(expectedReference), eq("127.0.0.1"));
        }

        @Test
        void referenceCollision_exhaustsRetries_rethrowsAndSkipsAudit() {
            UUID uploaderId = UUID.randomUUID();
            UUID clientId = UUID.randomUUID();
            AuthUser user = staffUser(uploaderId);
            when(jdbc.query(contains("SELECT role FROM users WHERE id = ?"), any(RowMapper.class), eq(clientId)))
                    .thenReturn(List.of("CLIENT_PP"));
            when(jdbc.queryForObject(eq("SELECT count(*) FROM documents"), eq(Long.class)))
                    .thenReturn(0L);
            when(jdbc.queryForObject(contains("INSERT INTO documents"), eq(UUID.class), anyString(), eq("ATTESTATION"), eq("Titre du document"), eq(clientId), eq(uploaderId), eq("application/pdf"), eq("12KB"), isNull()))
                    .thenThrow(new DataIntegrityViolationException("duplicate reference"));
            assertThatThrownBy(() -> controller.upload(user, ip, uploadRequest(clientId, "application/pdf", null)))
                    .isInstanceOf(DataIntegrityViolationException.class);
            verify(jdbc, times(5)).queryForObject(contains("INSERT INTO documents"), eq(UUID.class), anyString(), eq("ATTESTATION"), eq("Titre du document"), eq(clientId), eq(uploaderId), eq("application/pdf"), eq("12KB"), isNull());
            verifyNoInteractions(audit);
        }

        @Test
        void validateDestinataireMapper_extractsRole() throws SQLException {
            UUID clientId = UUID.randomUUID();
            when(jdbc.query(contains("SELECT role FROM users WHERE id = ?"), any(RowMapper.class), eq(clientId)))
                    .thenReturn(List.of());
            AuthUser user = staffUser(UUID.randomUUID());

            try {
                controller.upload(user, ip, uploadRequest(clientId, "application/pdf", null));
            } catch (ApiException ignored) { }

            ArgumentCaptor<RowMapper<String>> captor = ArgumentCaptor.forClass(RowMapper.class);
            verify(jdbc).query(contains("SELECT role FROM users WHERE id = ?"), captor.capture(), eq(clientId));
            RowMapper<String> mapper = captor.getValue();

            ResultSet rs = mock(ResultSet.class);
            when(rs.getString("role")).thenReturn("CLIENT_PP");

            assertThat(mapper.mapRow(rs, 1)).isEqualTo("CLIENT_PP");
        }

        @Test
        void nullMimeType_defaultsToApplicationPdf() {
            UUID uploaderId = UUID.randomUUID();
            UUID clientId = UUID.randomUUID();
            UUID newId = UUID.randomUUID();
            AuthUser user = staffUser(uploaderId);

            when(jdbc.query(contains("SELECT role FROM users WHERE id = ?"), any(RowMapper.class), eq(clientId)))
                    .thenReturn(List.of("CLIENT_PP"));
            when(jdbc.queryForObject(eq("SELECT count(*) FROM documents"), eq(Long.class))).thenReturn(0L);
            when(jdbc.queryForObject(contains("INSERT INTO documents"), eq(UUID.class),
                    anyString(), eq("ATTESTATION"), eq("Titre du document"), eq(clientId),
                    eq(uploaderId), eq("application/pdf"), eq("12KB"), isNull()))
                    .thenReturn(newId);
            when(jdbc.query(contains("FROM documents d JOIN users u"), any(RowMapper.class), eq(newId)))
                    .thenReturn(List.of(doc(newId, clientId, null)));

            ResponseEntity<DocumentResponse> response = controller.upload(user, ip,
                    uploadRequest(clientId, null, null));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        }

        @Test
        void plainBase64Contenu_notDataUri_skipsConsistencyCheck() {
            UUID uploaderId = UUID.randomUUID();
            UUID clientId = UUID.randomUUID();
            UUID newId = UUID.randomUUID();
            AuthUser user = staffUser(uploaderId);

            when(jdbc.query(contains("SELECT role FROM users WHERE id = ?"), any(RowMapper.class), eq(clientId)))
                    .thenReturn(List.of("CLIENT_PP"));
            when(jdbc.queryForObject(eq("SELECT count(*) FROM documents"), eq(Long.class))).thenReturn(0L);
            when(jdbc.queryForObject(contains("INSERT INTO documents"), eq(UUID.class),
                    anyString(), eq("ATTESTATION"), eq("Titre du document"), eq(clientId),
                    eq(uploaderId), eq("application/pdf"), eq("12KB"), eq("QUJD")))
                    .thenReturn(newId);
            when(jdbc.query(contains("FROM documents d JOIN users u"), any(RowMapper.class), eq(newId)))
                    .thenReturn(List.of(doc(newId, clientId, null)));

            ResponseEntity<DocumentResponse> response = controller.upload(user, ip,
                    uploadRequest(clientId, "application/pdf", "QUJD"));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        }

        @Test
        void dataUriDeclaredTypeMatchesResolvedMime_succeeds() {
            UUID uploaderId = UUID.randomUUID();
            UUID clientId = UUID.randomUUID();
            UUID newId = UUID.randomUUID();
            AuthUser user = staffUser(uploaderId);
            String contenu = "data:application/pdf;base64,QUJD";

            when(jdbc.query(contains("SELECT role FROM users WHERE id = ?"), any(RowMapper.class), eq(clientId)))
                    .thenReturn(List.of("CLIENT_PP"));
            when(jdbc.queryForObject(eq("SELECT count(*) FROM documents"), eq(Long.class))).thenReturn(0L);
            when(jdbc.queryForObject(contains("INSERT INTO documents"), eq(UUID.class),
                    anyString(), eq("ATTESTATION"), eq("Titre du document"), eq(clientId),
                    eq(uploaderId), eq("application/pdf"), eq("12KB"), eq(contenu)))
                    .thenReturn(newId);
            when(jdbc.query(contains("FROM documents d JOIN users u"), any(RowMapper.class), eq(newId)))
                    .thenReturn(List.of(doc(newId, clientId, null)));

            ResponseEntity<DocumentResponse> response = controller.upload(user, ip,
                    uploadRequest(clientId, "application/pdf", contenu));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        }
    }

    @Nested
    class RowMapperCoverage {

        @Test
        void mapper_combinesNomAndPrenomWhenPrenomPresent() throws SQLException {
            UUID id = UUID.randomUUID();
            UUID clientId = UUID.randomUUID();
            UUID uploadedBy = UUID.randomUUID();
            AuthUser user = staffUser(UUID.randomUUID());

            when(jdbc.query(contains("FROM documents d JOIN users u"), any(RowMapper.class), eq(id)))
                    .thenReturn(List.of());
            try {
                controller.get(user, id);
            } catch (ApiException ignored) {
                // we only care about capturing the mapper, not the outcome here
            }

            ArgumentCaptor<RowMapper<DocumentResponse>> captor = ArgumentCaptor.forClass(RowMapper.class);
            verify(jdbc).query(contains("FROM documents d JOIN users u"), captor.capture(), eq(id));
            RowMapper<DocumentResponse> mapper = captor.getValue();

            ResultSet rs = mock(ResultSet.class);
            when(rs.getObject("id", UUID.class)).thenReturn(id);
            when(rs.getString("reference")).thenReturn("DOC-20260709-000001");
            when(rs.getString("type")).thenReturn("ATTESTATION");
            when(rs.getString("titre")).thenReturn("Titre");
            when(rs.getObject("client_id", UUID.class)).thenReturn(clientId);
            when(rs.getString("client_nom")).thenReturn("Nom");
            when(rs.getString("client_prenom")).thenReturn("Prenom");
            when(rs.getObject("uploaded_by", UUID.class)).thenReturn(uploadedBy);
            when(rs.getString("mime_type")).thenReturn("application/pdf");
            when(rs.getString("taille")).thenReturn("12KB");
            when(rs.getInt("telechargements")).thenReturn(0);
            when(rs.getObject("date_generation", OffsetDateTime.class))
                    .thenReturn(OffsetDateTime.now(ZoneOffset.UTC));

            DocumentResponse mapped = mapper.mapRow(rs, 1);

            assertThat(mapped.clientNom()).isEqualTo("Nom Prenom");
        }

        @Test
        void mapper_usesNomAloneWhenPrenomIsNullOrEmpty() throws SQLException {
            UUID id = UUID.randomUUID();
            AuthUser user = staffUser(UUID.randomUUID());

            when(jdbc.query(contains("FROM documents d JOIN users u"), any(RowMapper.class), eq(id)))
                    .thenReturn(List.of());
            try {
                controller.get(user, id);
            } catch (ApiException ignored) { }

            ArgumentCaptor<RowMapper<DocumentResponse>> captor = ArgumentCaptor.forClass(RowMapper.class);
            verify(jdbc).query(contains("FROM documents d JOIN users u"), captor.capture(), eq(id));
            RowMapper<DocumentResponse> mapper = captor.getValue();

            ResultSet rs = mock(ResultSet.class);
            when(rs.getObject("id", UUID.class)).thenReturn(id);
            when(rs.getString("reference")).thenReturn("DOC-20260709-000002");
            when(rs.getString("type")).thenReturn("ATTESTATION");
            when(rs.getString("titre")).thenReturn("Titre");
            when(rs.getObject("client_id", UUID.class)).thenReturn(UUID.randomUUID());
            when(rs.getString("client_nom")).thenReturn("Nom");
            when(rs.getString("client_prenom")).thenReturn(""); // empty -> triggers isEmpty() branch
            when(rs.getObject("uploaded_by", UUID.class)).thenReturn(UUID.randomUUID());
            when(rs.getString("mime_type")).thenReturn("application/pdf");
            when(rs.getString("taille")).thenReturn("12KB");
            when(rs.getInt("telechargements")).thenReturn(0);
            when(rs.getObject("date_generation", OffsetDateTime.class))
                    .thenReturn(OffsetDateTime.now(ZoneOffset.UTC));

            DocumentResponse mapped = mapper.mapRow(rs, 1);

            assertThat(mapped.clientNom()).isEqualTo("Nom");
        }
    }
}