import time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

options = Options()
options.add_argument('--headless')
options.add_argument('--disable-gpu')
options.add_argument('--no-sandbox')
options.add_argument('--disable-dev-shm-usage')
options.set_capability('goog:loggingPrefs', {'browser': 'ALL'})

driver = webdriver.Chrome(options=options)
driver.set_window_size(1920, 1080)

def set_react_input(driver, element, value):
    driver.execute_script("""
        var setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setValue.call(arguments[0], arguments[1]);
        arguments[0].dispatchEvent(new Event('input', { bubbles: true }));
        arguments[0].dispatchEvent(new Event('change', { bubbles: true }));
    """, element, value)
    time.sleep(0.2)

try:
    print("🚀 Navigating to admin login page...")
    driver.get("http://localhost:5173/admin/login?redirect=/sales")
    
    username_field = WebDriverWait(driver, 20).until(
        EC.presence_of_element_located((By.ID, "username"))
    )
    password_field = driver.find_element(By.ID, "password")
    
    print("🔑 Logging in as 'krish' / 'admin123'...")
    set_react_input(driver, username_field, "krish")
    set_react_input(driver, password_field, "admin123")
    
    submit_button = driver.find_element(By.CLASS_NAME, "login-submit-btn")
    driver.execute_script("arguments[0].click();", submit_button)
    
    print("⏳ Waiting for CRM dashboard redirect...")
    try:
        WebDriverWait(driver, 25).until(
            EC.url_contains("/sales")
        )
    except Exception:
        driver.save_screenshot("/Users/krish/.gemini/antigravity-ide/brain/e4265533-b86e-40cf-a608-7315d5249fa1/login_timeout_failure.png")
        print("❌ Login timed out. Body text content:")
        print(driver.find_element(By.TAG_NAME, "body").text[:1000])
        print("\n--- BROWSER CONSOLE LOGS ---")
        for entry in driver.get_log('browser'):
            print(f"[{entry['level']}] {entry['message']}")
        raise
        
    time.sleep(3)
    print("📍 Redirected successfully to:", driver.current_url)
    
    print("🖱️ Locating and clicking 'My Profile' tab in the sidebar...")
    profile_tab = WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.XPATH, "//span[text()='My Profile']/.."))
    )
    driver.execute_script("arguments[0].click();", profile_tab)
    time.sleep(3)
    
    print("📍 Current URL after profile click:", driver.current_url)
    # Check which sidebar tab has 'active' class
    active_tabs = driver.find_elements(By.CLASS_NAME, "sidebar-nav-link")
    for tab in active_tabs:
        if "active" in tab.get_attribute("class"):
            print(f"🔥 Active tab in sidebar: {tab.text}")
            
    print("📸 Taking screenshot of My Profile tab...")
    driver.save_screenshot("/Users/krish/.gemini/antigravity-ide/brain/e4265533-b86e-40cf-a608-7315d5249fa1/profile_tab_loaded.png")
    
    # 1. Verify User Information
    print("🔍 Verifying profile details...")
    profile_name = driver.find_element(By.XPATH, "//span[text()='Name']/following-sibling::span").text
    profile_role = driver.find_element(By.XPATH, "//span[text()='Role']/following-sibling::span").text
    print(f"👤 Displayed Name: {profile_name}, Role: {profile_role}")
    assert "krish" in profile_name.lower()
    assert "admin" in profile_role.lower()
    
    # 2. Test incorrect current password
    print("❌ Testing incorrect current password input...")
    current_pwd_input = driver.find_element(By.ID, "currentPassword")
    new_pwd_input = driver.find_element(By.ID, "newPassword")
    confirm_pwd_input = driver.find_element(By.ID, "confirmNewPassword")
    submit_change_btn = driver.find_element(By.CLASS_NAME, "password-submit-btn")
    
    set_react_input(driver, current_pwd_input, "wrong_current_password")
    set_react_input(driver, new_pwd_input, "newpassword123")
    set_react_input(driver, confirm_pwd_input, "newpassword123")
    
    driver.execute_script("arguments[0].click();", submit_change_btn)
    
    # Wait for error message banner
    try:
        error_banner = WebDriverWait(driver, 15).until(
            EC.presence_of_element_located((By.CLASS_NAME, "profile-message-banner"))
        )
        print("⚠️ Received validation response:", error_banner.text)
        assert "incorrect" in error_banner.text.lower() or "failed" in error_banner.text.lower()
    except Exception as e:
        driver.save_screenshot("/Users/krish/.gemini/antigravity-ide/brain/e4265533-b86e-40cf-a608-7315d5249fa1/wrong_pwd_submit_failure.png")
        print("❌ Wrong password submit wait failed. Browser logs:")
        for entry in driver.get_log('browser'):
            print(f"[{entry['level']}] {entry['message']}")
        raise e
    
    # 3. Test passwords mismatch
    print("❌ Testing password mismatch warning...")
    set_react_input(driver, current_pwd_input, "admin123")
    set_react_input(driver, new_pwd_input, "newpassword123")
    set_react_input(driver, confirm_pwd_input, "different_confirm_password")
    
    driver.execute_script("arguments[0].click();", submit_change_btn)
    
    try:
        error_banner = WebDriverWait(driver, 15).until(
            EC.presence_of_element_located((By.CLASS_NAME, "profile-message-banner"))
        )
        print("⚠️ Received validation response:", error_banner.text)
        assert "match" in error_banner.text.lower()
    except Exception as e:
        driver.save_screenshot("/Users/krish/.gemini/antigravity-ide/brain/e4265533-b86e-40cf-a608-7315d5249fa1/mismatch_pwd_submit_failure.png")
        raise e
    
    # 4. Test successful password change
    print("✅ Testing successful password update (admin123 -> admin456)...")
    set_react_input(driver, current_pwd_input, "admin123")
    set_react_input(driver, new_pwd_input, "admin456")
    set_react_input(driver, confirm_pwd_input, "admin456")
    
    driver.execute_script("arguments[0].click();", submit_change_btn)
    
    try:
        success_banner = WebDriverWait(driver, 20).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, ".profile-message-banner.success"))
        )
        print("🎉 Success banner text:", success_banner.text)
        assert "success" in success_banner.text.lower()
    except Exception as e:
        driver.save_screenshot("/Users/krish/.gemini/antigravity-ide/brain/e4265533-b86e-40cf-a608-7315d5249fa1/success_pwd_submit_failure.png")
        print("❌ Success password change submit failed. Browser console:")
        for entry in driver.get_log('browser'):
            print(f"[{entry['level']}] {entry['message']}")
        raise e
    
    # 5. Log out
    print("🚪 Logging out from the application...")
    logout_btn = driver.find_element(By.CLASS_NAME, "sidebar-logout-btn")
    driver.execute_script("arguments[0].click();", logout_btn)
    time.sleep(2)
    
    # 6. Log in with the new password
    print("🔑 Verifying login with the updated password (admin456)...")
    driver.get("http://localhost:5173/admin/login?redirect=/sales")
    username_field = WebDriverWait(driver, 20).until(
        EC.presence_of_element_located((By.ID, "username"))
    )
    password_field = driver.find_element(By.ID, "password")
    set_react_input(driver, username_field, "krish")
    set_react_input(driver, password_field, "admin456")
    
    submit_button = driver.find_element(By.CLASS_NAME, "login-submit-btn")
    driver.execute_script("arguments[0].click();", submit_button)
    
    WebDriverWait(driver, 25).until(
        EC.url_contains("/sales")
    )
    print("📍 Successfully logged in with NEW password!")
    
    # 7. Revert password back to original to preserve test state
    print("🔄 Reverting password back to 'admin123' to preserve original test state...")
    profile_tab = WebDriverWait(driver, 10).until(
        EC.element_to_be_clickable((By.XPATH, "//span[text()='My Profile']/.."))
    )
    driver.execute_script("arguments[0].click();", profile_tab)
    time.sleep(2)
    
    current_pwd_input = driver.find_element(By.ID, "currentPassword")
    new_pwd_input = driver.find_element(By.ID, "newPassword")
    confirm_pwd_input = driver.find_element(By.ID, "confirmNewPassword")
    submit_change_btn = driver.find_element(By.CLASS_NAME, "password-submit-btn")
    
    set_react_input(driver, current_pwd_input, "admin456")
    set_react_input(driver, new_pwd_input, "admin123")
    set_react_input(driver, confirm_pwd_input, "admin123")
    
    driver.execute_script("arguments[0].click();", submit_change_btn)
    
    success_banner = WebDriverWait(driver, 20).until(
        EC.presence_of_element_located((By.CSS_SELECTOR, ".profile-message-banner.success"))
    )
    print("🎉 Revert success banner:", success_banner.text)
    
    print("🌟 ALL AUTOMATED SELENIUM TESTS PASSED SUCCESSFULLY!")

finally:
    driver.quit()
